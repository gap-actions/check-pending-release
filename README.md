# check-pending-release

This GitHub action checks whether a repository has commits that are not part of
any release yet: it compares the current commit against the most recent tag and
ignores changes to paths that do not warrant a release, such as CI
configuration.

It comes with a [reusable workflow](#reusable-workflow) which runs the check on
a schedule and, once nobody has touched the unreleased changes for a week,
tracks them in a GitHub issue. Most packages want that
workflow; use the action directly only if you need a different reaction to a
pending release.

## Reusable workflow

Add the following as `.github/workflows/check-pending-release.yml` to your
package repository:

```yaml
name: Check for pending release

on:
  schedule:
    - cron: '0 6 * * 1'   # every Monday at 06:00 UTC
  workflow_dispatch:

permissions:
  contents: read
  issues: write

jobs:
  check:
    uses: gap-actions/check-pending-release/.github/workflows/reusable.yml@v1
```

Changes are reported only once they have been left untouched for
`min-quiet-days`, so that a rework spanning several weeks is not flagged while
it is still going on; what gets reported is work someone walked away from.
Changes to ignored paths do not reset that clock. While such changes exist, the
workflow keeps a single open issue up to date; once a release has been made, it
comments on that issue and closes it.

### Inputs

All of the following inputs are optional.

- `ignore`:
  - Newline- or comma-separated list of path prefixes whose changes do not warrant a release. A prefix also covers everything below it, so `.github` ignores `.github/workflows/CI.yml`.
  - default: `".github\n.gitignore"`
- `min-quiet-days`:
  - Only report a pending release once its most recent change is this many days old.
  - default: `7`
- `issue-title`:
  - Title of the tracking issue.
  - default: `'Pending release'`
- `issue-label`:
  - Label used to find the tracking issue again; created if missing.
  - default: `'pending release'`
- `max-files`:
  - Maximum number of changed files to list in the issue.
  - default: `50`

## Action

The action performs the check only; it neither schedules itself, nor decides
which age warrants a report, nor reports anything. It needs the full history and all tags, so check out with
`fetch-depth: 0`.

```yaml
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - id: check
        uses: gap-actions/check-pending-release@v1
        with:
          ignore: |
            .github
            .gitignore
            doc
      - if: ${{ steps.check.outputs.pending == 'true' }}
        run: echo "${{ steps.check.outputs.commits }} commits since ${{ steps.check.outputs.since-tag }}"
```

### Inputs

- `ignore`:
  - As above.
  - default: `".github\n.gitignore"`

### Outputs

- `pending`: `'true'` if there are unreleased changes, `'false'` otherwise.
- `since-tag`: the most recent tag the check compared against, empty if the repository has no tags.
- `files`: newline-separated list of files changed since that tag, ignored paths removed.
- `commits`: number of commits since that tag which changed non-ignored files, `0` if there is no pending release.
- `age-days`: age of that tag in days, `0` if the repository has no tags.
- `quiet-days`: days since the most recent unreleased change, `0` if there is no pending release.

A repository without any tags counts as pending, because nothing in it was ever
released.

## Contact
Please submit bug reports, suggestions for improvements and patches via
the [issue tracker](https://github.com/gap-actions/check-pending-release/issues).

## License
The action `check-pending-release` is free software; you can redistribute
and/or modify it under the terms of the GNU General Public License as published
by the Free Software Foundation; either version 2 of the License, or (at your
opinion) any later version. For details, see the file `LICENSE` distributed
with this action or the FSF's own site.
