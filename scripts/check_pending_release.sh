#!/usr/bin/env bash
#
# Determine whether the repository has commits that are not part of any
# release yet, i.e. commits after the most recent tag which touch files
# outside of the ignore list.
#
# Usage: check_pending_release.sh <ignore-list>
#
# The ignore list is a newline- and/or comma-separated list of path prefixes,
# e.g. ".github" also ignores ".github/workflows/CI.yml".
#
# Results are reported via $GITHUB_OUTPUT (pending, since-tag, files, commits,
# age-days) and summarized in $GITHUB_STEP_SUMMARY.

set -euo pipefail

GITHUB_OUTPUT=${GITHUB_OUTPUT:-/dev/stdout}
GITHUB_STEP_SUMMARY=${GITHUB_STEP_SUMMARY:-/dev/null}

SECONDS_PER_DAY=86400

# Write a single-line output value.
set_output() {
    echo "$1=$2" >>"$GITHUB_OUTPUT"
}

# Write a multi-line output value, using a delimiter that cannot occur in it.
set_multiline_output() {
    local name=$1 value=$2 delim="ghadelim_${RANDOM}${RANDOM}"
    {
        echo "$name<<$delim"
        echo "$value"
        echo "$delim"
    } >>"$GITHUB_OUTPUT"
}

# Normalize the ignore list into one prefix per line, without trailing slashes.
read_ignore_list() {
    echo "$1" | tr ',' '\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's#/*$##' | grep -v '^$' || true
}

IGNORED=()
while IFS= read -r prefix; do
    IGNORED+=("$prefix")
done < <(read_ignore_list "${1-}")

# True if the given path lies inside one of the ignored prefixes.
is_ignored() {
    local file=$1 prefix
    for prefix in ${IGNORED+"${IGNORED[@]}"}; do
        [[ $file == "$prefix" || $file == "$prefix"/* ]] && return 0
    done
    return 1
}

TAG=$(git describe --tags --abbrev=0 2>/dev/null || true)

# Without any tag nothing was ever released, so every tracked file counts as
# pending; otherwise we look at what changed since the most recent tag.
if [[ -z $TAG ]]; then
    CANDIDATES=$(git -c core.quotePath=false ls-files)
    AGE_DAYS=0
else
    CANDIDATES=$(git -c core.quotePath=false diff --name-only "$TAG..HEAD")
    TAG_TIMESTAMP=$(git log -1 --format=%ct "$TAG")
    AGE_DAYS=$(( ( $(date +%s) - TAG_TIMESTAMP ) / SECONDS_PER_DAY ))
fi

FILES=()
while IFS= read -r file; do
    [[ -z $file ]] && continue
    is_ignored "$file" || FILES+=("$file")
done <<<"$CANDIDATES"

if [[ ${#FILES[@]} -gt 0 ]]; then
    PENDING=true
else
    PENDING=false
fi

COMMITS=0
if [[ $PENDING == true && -n $TAG ]]; then
    COMMITS=$(git rev-list --count "$TAG..HEAD")
fi

FILE_LIST=$(printf '%s\n' ${FILES+"${FILES[@]}"})

set_output pending "$PENDING"
set_output since-tag "$TAG"
set_output commits "$COMMITS"
set_output age-days "$AGE_DAYS"
set_multiline_output files "$FILE_LIST"

{
    if [[ $PENDING == false ]]; then
        echo "No pending release: no relevant changes since \`${TAG:-<no tag>}\`."
    elif [[ -z $TAG ]]; then
        echo "Pending release: this repository has no tags at all."
    else
        echo "Pending release: $COMMITS commit(s) since \`$TAG\` ($AGE_DAYS days ago)."
    fi
    if [[ $PENDING == true ]]; then
        echo
        echo "Changed files:"
        echo '```'
        echo "$FILE_LIST"
        echo '```'
    fi
} >>"$GITHUB_STEP_SUMMARY"
