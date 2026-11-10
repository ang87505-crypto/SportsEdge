#!/usr/bin/env bash
# Separate append-only research ledger for forward-only virtual tracking (mq-buffer-v1).
# Usage: forward-ledger-branch.sh checkout | commit "<message>"
# Branch `research-forward-ledger`, checked out into ./forward-ledger. Existing files may never change or disappear;
# chain.jsonl and events.jsonl may only grow. Uses the job's GITHUB_TOKEN through an HTTP header only.
set -euo pipefail
dir="${LEDGER_DIR:-forward-ledger}"
branch="${LEDGER_BRANCH:-research-forward-ledger}"
case "$branch" in
  research-forward-ledger|research-forward-ledger-rehearsal) ;;
  *) echo "unknown ledger branch"; exit 2 ;;
esac
auth="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
url="https://github.com/${GITHUB_REPOSITORY}.git"
case "$1" in
  checkout)
    git init -q "$dir"
    cd "$dir"
    git config user.name 'sportsedge-research-bot'
    git config user.email 'sportsedge-research-bot@users.noreply.github.com'
    if git -c http.extraheader="$auth" fetch -q "$url" "$branch" 2>/dev/null; then
      git checkout -q -b "$branch" FETCH_HEAD
    else
      git checkout -q --orphan "$branch"
      printf '# SportsEdge forward ledger (research only): %s\n\nAppend-only virtual predictions, server receipts and outcomes for mq-buffer-v1. No orders. Never edit by hand.\n' "$branch" > README.md
    fi
    ;;
  commit)
    cd "$dir"
    git add -A
    if git diff --cached --quiet; then echo "nothing to commit"; exit 0; fi
    if git rev-parse -q --verify HEAD >/dev/null; then
      changed=$(git diff --cached --name-status HEAD | awk '$1 != "A" {print $2}' | grep -v -E '^(chain|events)\.jsonl$' || true)
      if [ -n "$changed" ]; then echo "APPEND_ONLY_VIOLATION: $changed"; exit 1; fi
      for f in chain.jsonl events.jsonl; do
        if git cat-file -e "HEAD:$f" 2>/dev/null; then
          old=$(git show "HEAD:$f" | wc -c); new=$(wc -c < "$f")
          if [ "$(head -c "$old" "$f" | sha256sum)" != "$(git show "HEAD:$f" | sha256sum)" ] || [ "$new" -lt "$old" ]; then
            echo "APPEND_ONLY_VIOLATION: $f was rewritten"; exit 1
          fi
        fi
      done
    fi
    git commit -q -m "$2"
    git -c http.extraheader="$auth" push -q "$url" "HEAD:$branch"
    git log -1 --format='%H %cI'
    ;;
esac
