#!/usr/bin/env bash
# Publish the operations monitor's output to the ops-status branch: status.json is replaced, the monthly
# history file is appended. Usage: ops-status-branch.sh <dir-with-status.json-and-history-line.json>
# Uses the job's GITHUB_TOKEN through an HTTP header; the token never enters a URL or a file.
set -euo pipefail
src=$(cd "$1" && pwd)
dir=$(mktemp -d)
auth="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
# OPS_STATUS_REMOTE exists only for the local test (a bare repository path); production always uses GitHub.
url="${OPS_STATUS_REMOTE:-https://github.com/${GITHUB_REPOSITORY}.git}"
cd "$dir"
git init -q .
git config user.name 'sportsedge-ops-monitor'
git config user.email 'sportsedge-ops-monitor@users.noreply.github.com'
for attempt in 1 2 3 4; do
  if git -c http.extraheader="$auth" fetch -q --depth 1 "$url" ops-status 2>/dev/null; then
    git checkout -q -f -B ops-status FETCH_HEAD
    git clean -qfdx
  else
    git checkout -q --orphan ops-status
    git rm -rq --cached . 2>/dev/null || true
    printf '# SportsEdge operations status\n\nWritten by the ops-monitor workflow. `status.json` is the latest check; `history/` keeps one line per check. Never edit by hand.\n' > README.md
  fi
  cp "$src/status.json" status.json
  # Data-only branch: tell Vercel not to build a deployment for any of its (frequent) commits.
  printf '{\n  "git": {"deploymentEnabled": false}\n}\n' > vercel.json
  mkdir -p history
  month=$(date -u +%Y-%m)
  printf '%s\n' "$(tr -d '\n' < "$src/history-line.json")" >> "history/$month.jsonl"
  git add -A
  git commit -q -m "ops status $(date -u +%Y-%m-%dT%H:%MZ) run ${GITHUB_RUN_ID:-local}"
  if git -c http.extraheader="$auth" push -q "$url" HEAD:ops-status; then git rev-parse HEAD; exit 0; fi
  echo "push attempt $attempt refused; refetching" >&2
  sleep $((attempt * 3))
done
echo "OPS_STATUS_PUSH_FAILED" >&2
exit 1
