#!/usr/bin/env bash
#
# Fetch the Salesforce HERB corpus into data/herb.
# CC-BY-NC-4.0. Used unmodified as both corpus and ground truth.

set -euo pipefail
cd "$(dirname "$0")/.."

BASE="https://huggingface.co/datasets/Salesforce/HERB/resolve/main"
mkdir -p data/herb/products

echo "fetching metadata"
for f in employee.json salesforce_team.json customers_data.json; do
  curl -sSL --fail --max-time 120 -o "data/herb/$f" "$BASE/metadata/$f"
  printf '  %-24s %s bytes\n' "$f" "$(wc -c < "data/herb/$f")"
done

echo "listing products"
products=$(curl -sSL --fail --max-time 60 "https://huggingface.co/api/datasets/Salesforce/HERB" \
  | python3 -c 'import json,sys; [print(s["rfilename"]) for s in json.load(sys.stdin).get("siblings",[]) if s.get("rfilename","").startswith("products/")]')

count=0
while read -r f; do
  [ -z "$f" ] && continue
  curl -sSL --fail --max-time 180 -o "data/herb/products/$(basename "$f")" "$BASE/$f"
  count=$((count + 1))
  printf '\r  products %d' "$count"
done <<< "$products"

echo
echo "done: $(du -sh data/herb | cut -f1) in data/herb"
