#!/usr/bin/env bash
# Check out (or create) the append-only research-data branch into ./research-data, or commit and push it.
# Usage: research-data-branch.sh checkout | commit "<message>"
# Uses the job's GITHUB_TOKEN through an HTTP header; the token never enters a URL or a file.
set -euo pipefail
dir=research-data
auth="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
# RESEARCH_DATA_REMOTE exists only for the local test (a bare repository path); production always uses GitHub.
url="${RESEARCH_DATA_REMOTE:-https://github.com/${GITHUB_REPOSITORY}.git}"
case "$1" in
  checkout)
    git init -q "$dir"
    cd "$dir"
    git config user.name 'sportsedge-research-bot'
    git config user.email 'sportsedge-research-bot@users.noreply.github.com'
    if git -c http.extraheader="$auth" fetch -q --depth 1 "$url" research-data 2>/dev/null; then
      git checkout -q -b research-data FETCH_HEAD
    else
      git checkout -q --orphan research-data
      printf '# SportsEdge research data\n\nAppend-only snapshots, results and reports written by the research workflows. Never edit by hand.\n' > README.md
      printf '.cache/\n' > .gitignore
    fi
    ;;
  commit)
    cd "$dir"
    # Data-only branch: tell Vercel not to build a deployment for its commits (added once, never rewritten).
    [ -f vercel.json ] || printf '{\n  "git": {"deploymentEnabled": false}\n}\n' > vercel.json
    git add -A
    if git diff --cached --quiet; then echo "nothing to commit"; exit 0; fi
    # Snapshots/results stay append-only. LATEST.md and summary.json are derived latest views.
    if git rev-parse -q --verify HEAD >/dev/null; then
      changed=$(git diff --cached --name-status HEAD | awk '$1 != "A" {print $2}' | grep -v -E '^(reports/LATEST\.md|summary\.json|manifest\.jsonl|items\.jsonl|runs\.jsonl)$' || true)
      if [ -n "$changed" ]; then echo "APPEND_ONLY_VIOLATION: $changed"; exit 1; fi
      for f in manifest.jsonl items.jsonl runs.jsonl; do
        if git cat-file -e "HEAD:$f" 2>/dev/null; then
          old=$(git show "HEAD:$f" | wc -c); new=$(wc -c < "$f")
          if [ "$(head -c "$old" "$f" | sha256sum)" != "$(git show "HEAD:$f" | sha256sum)" ] || [ "$new" -lt "$old" ]; then
            echo "APPEND_ONLY_VIOLATION: $f was rewritten"; exit 1
          fi
        fi
      done
    fi
    git commit -q -m "$2"
    git -c http.extraheader="$auth" push -q "$url" HEAD:research-data
    git rev-parse HEAD
    ;;
esac
