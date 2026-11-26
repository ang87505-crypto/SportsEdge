#!/usr/bin/env bash
# Download one retrieval run's artifact (PR #226) and verify it BEFORE extracting anything.
# - The run must be a successful "Independent weather archive retrieval pilot" run of this repository.
# - Zip entries must be plain file names: no directories, absolute paths or "..".
# - Every file, including the CLI zip, must match the receipt's SHA-256 before the CLI zip is extracted.
# Usage: weather-archive-fetch.sh <run id | current> <artifact name> <out dir>
set -euo pipefail
run="$1"; name="$2"; out="$3"
[[ "$name" =~ ^[a-z0-9][a-z0-9-]{0,80}$ ]] || { echo "unsafe artifact name"; exit 1; }
if [ "$run" = current ]; then run="$GITHUB_RUN_ID"
else
  [[ "$run" =~ ^[0-9]{1,20}$ ]] || { echo "invalid run id"; exit 1; }
  test "$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run" --jq '.name + "|" + .conclusion')" = "Independent weather archive retrieval pilot|success"
fi
id=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run/artifacts" --jq ".artifacts[]|select(.name==\"$name\" and .expired==false)|.id" | head -1)
[[ "$id" =~ ^[0-9]+$ ]] || { echo "artifact $name missing or expired"; exit 1; }
mkdir -p "$out/in" "$out/cli"
gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$id/zip" > "$out/artifact.zip"
safe() { while IFS= read -r e; do [[ "$e" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$ ]] || { echo "unsafe zip entry: $e"; exit 1; }; done; }
unzip -Z1 "$out/artifact.zip" | safe
unzip -q "$out/artifact.zip" -d "$out/in"
jq -e '.status=="RETRIEVED_UNVALIDATED" and .exchange_requests==0' "$out/in/receipt.json" >/dev/null
for f in $(jq -r '.files[].name' "$out/in/receipt.json"); do
  [[ "$f" =~ ^[a-z0-9][a-z0-9.-]{0,80}$ ]] || { echo "unexpected file name"; exit 1; }
  want=$(jq -r --arg f "$f" '.files[]|select(.name==$f)|.sha256' "$out/in/receipt.json")
  got=$(sha256sum "$out/in/$f" | cut -c1-64)
  [ "$want" = "$got" ] || { echo "hash mismatch: $f"; exit 1; }
done
cli=$(jq -r '.files[]|select(.name|endswith(".zip"))|.name' "$out/in/receipt.json")
unzip -Z1 "$out/in/$cli" | safe
# The archive can repeat an entry name (2024: CLINYC_202403080627.txt twice). Never overwrite: identical repeats are
# dropped, differing repeats are kept as <name>.dupN so the parser sees every product and can refuse a conflict.
python3 -I - "$out/in/$cli" "$out/cli" <<'PY'
import hashlib, pathlib, re, sys, zipfile
src, dst = sys.argv[1], pathlib.Path(sys.argv[2]); seen = {}; dup_same = dup_diff = 0
with zipfile.ZipFile(src) as z:
    infos = [i for i in z.infolist() if not i.is_dir()]
    if sum(i.file_size for i in infos) > 64 * 1024 * 1024: sys.exit("oversized CLI archive")
    for i in infos:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,120}", i.filename): sys.exit("unsafe zip entry")
        data = z.read(i); h = hashlib.sha256(data).hexdigest(); prior = seen.setdefault(i.filename, [])
        if h in prior: dup_same += 1; continue
        name = i.filename if not prior else f"{i.filename}.dup{len(prior) + 1}"
        if prior: dup_diff += 1
        prior.append(h); (dst / name).write_bytes(data)
print(f"cli entries {len(infos)}, identical repeats dropped {dup_same}, differing repeats kept {dup_diff}")
PY
echo "verified run $run artifact $id: $(jq -c '[.files[]|{name,sha256:(.sha256[0:12])}]' "$out/in/receipt.json")"
