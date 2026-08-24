#!/usr/bin/env python3
"""Determine whether a repository has commits that are not part of any release.

A release is pending if there are commits after the most recent tag which touch
files outside of the ignore list, e.g. a change to `src/foo.c` counts, while a
change to `.github/workflows/CI.yml` does not.

Usage: check_pending_release.py <ignore-list>

The ignore list is a newline- and/or comma-separated list of path prefixes, so
`.github` also covers `.github/workflows/CI.yml`.

Results are reported via $GITHUB_OUTPUT (pending, since-tag, files, commits,
age-days, pending-since-days) and summarized in $GITHUB_STEP_SUMMARY. Whether a
given age warrants a notification is policy and thus left to the caller; this
script only reports the facts.
"""

import os
import subprocess
import sys
import time
import uuid

SECONDS_PER_DAY = 86400


def git(*args):
    """Run a git command and return its output."""
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, check=True
    ).stdout


def exclude_pathspecs(raw_ignore_list):
    """Turn the `ignore` input into git pathspecs matching everything else.

    The `literal` magic keeps prefixes containing glob characters from being
    interpreted as patterns, and git excludes a directory together with all of
    its contents, which is exactly the prefix semantics we promise.
    """
    entries = raw_ignore_list.replace(",", "\n").splitlines()
    prefixes = [entry.strip().rstrip("/") for entry in entries if entry.strip()]

    return [".", *(f":(exclude,literal){prefix}" for prefix in prefixes)]


def latest_tag():
    """The most recent tag reachable from HEAD, or None if there is none."""
    try:
        return git("describe", "--tags", "--abbrev=0").strip()
    except subprocess.CalledProcessError:
        return None


def days_since(timestamp):
    return int((time.time() - timestamp) // SECONDS_PER_DAY)


def unreleased_files(tag, pathspecs):
    """The files changed since `tag`, ignored paths removed.

    Without a tag nothing was ever released, so all tracked files count.
    """
    if tag is None:
        output = git("ls-files", "-z", "--", *pathspecs)
    else:
        output = git("diff", "--name-only", "-z", f"{tag}..HEAD", "--", *pathspecs)

    return [path for path in output.split("\0") if path]


def pending_age_days(revisions, pathspecs):
    """Age in days of the oldest commit in `revisions` touching a relevant file.

    This is how long changes have been waiting for a release, as opposed to how
    long ago the last release was. Returns None if there is no such commit;
    `git log` describes merge commits by their parents, so that can happen even
    when files did change.
    """
    timestamps = git("log", "--format=%ct", revisions, "--", *pathspecs).split()
    if not timestamps:
        return None

    # `git log` reports the most recent commit first.
    return days_since(int(timestamps[-1]))


def write_outputs(outputs):
    """Report the results as GitHub action outputs."""
    lines = []
    for name, value in outputs.items():
        if "\n" not in str(value):
            lines.append(f"{name}={value}")
            continue

        # Multi-line values need a delimiter that cannot occur inside them.
        delimiter = f"ghadelim_{uuid.uuid4().hex}"
        lines.append(f"{name}<<{delimiter}\n{value}\n{delimiter}")

    append_to_file("GITHUB_OUTPUT", "\n".join(lines) + "\n", fallback=sys.stdout)


def write_summary(tag, files, commits, age_days, pending_since_days):
    """Report the results in human readable form."""
    if not files:
        text = f"No pending release: no relevant changes since `{tag or '<no tag>'}`.\n"
    elif tag is None:
        text = "Pending release: this repository has no tags at all.\n"
    else:
        text = (
            f"Pending release: {commits} commit(s) since `{tag}` ({age_days} days ago),"
            f" the oldest of them {pending_since_days} days old.\n"
        )

    if files:
        text += "\nChanged files:\n```\n" + "\n".join(files) + "\n```\n"

    append_to_file("GITHUB_STEP_SUMMARY", text)


def append_to_file(env_var, text, fallback=None):
    """Append to the file named by `env_var`, if the action runner set one."""
    path = os.environ.get(env_var)
    if path is None:
        if fallback is not None:
            fallback.write(text)
        return

    with open(path, "a", encoding="utf-8") as f:
        f.write(text)


def main():
    pathspecs = exclude_pathspecs(sys.argv[1] if len(sys.argv) > 1 else "")

    tag = latest_tag()
    age_days = 0 if tag is None else days_since(int(git("log", "-1", "--format=%ct", tag)))

    files = unreleased_files(tag, pathspecs)

    commits = 0
    pending_since_days = 0
    if files:
        revisions = "HEAD" if tag is None else f"{tag}..HEAD"
        if tag is not None:
            commits = int(git("rev-list", "--count", revisions))

        # Fall back to the tag age in the rare case that only a merge commit
        # introduced the pending changes.
        pending_since_days = pending_age_days(revisions, pathspecs)
        if pending_since_days is None:
            pending_since_days = age_days

    write_outputs(
        {
            "pending": "true" if files else "false",
            "since-tag": tag or "",
            "commits": commits,
            "age-days": age_days,
            "pending-since-days": pending_since_days,
            "files": "\n".join(files),
        }
    )
    write_summary(tag, files, commits, age_days, pending_since_days)


if __name__ == "__main__":
    main()
