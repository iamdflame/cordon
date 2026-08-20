#!/usr/bin/env bash
#
# Minimal reproduction: a result is silently truncated at 1,024 rows and the
# continuation cursor cannot be used to retrieve the rest.
#
# Written to be pasted into an upstream issue. It depends on nothing but bash,
# curl and a running HydraDB node, creates its own data in its own namespace,
# and cleans up after itself.
#
#   bash scripts/repro-row-cap.sh
#
# Why it matters beyond the row count: we hit this on a query for an
# authorization table. The query returned 1,024 of 1,371 membership edges with
# no error and a `next_cursor` that had expired by the time it was used, so a
# quarter of an access-control table was simply missing. It fails *open* and it
# looks exactly like success.

set -euo pipefail

ENDPOINT=${HYDRA_ENDPOINT:-http://127.0.0.1:8443}
TOKEN=${HYDRA_TOKEN:-local-development-token-32-bytes}
GRAPH=${HYDRA_GRAPH:-default}
CELL=${HYDRA_CELL:-cell-0}
LABEL="__rowcap_probe"
N=${N:-1500}

q() {
  curl -sS --max-time 60 "${ENDPOINT}/v1/graphs/${GRAPH}/query" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "X-Graph-Namespace: ${GRAPH}" \
    -H 'Content-Type: application/json' \
    --data "$(printf '{"cell_id":"%s","query":%s}' "${CELL}" "$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")"
}

cleanup() { q "MATCH (n:${LABEL}) DETACH DELETE n" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "1. creating ${N} nodes labelled :${LABEL}"
cleanup
for i in $(seq 1 "${N}"); do
  q "CREATE (n:${LABEL} {i: ${i}})" >/dev/null
  if [ $((i % 250)) -eq 0 ]; then printf '   %s\n' "${i}"; fi
done

echo
echo "2. count(*) — the engine knows how many there are"
q "MATCH (n:${LABEL}) RETURN count(*)" | python3 -m json.tool | head -20

echo
echo "3. returning them — note rows returned vs the count above, and next_cursor"
RESP=$(q "MATCH (n:${LABEL}) RETURN n.i")
printf '%s' "${RESP}" | python3 - <<'PY'
import json, sys
d = json.load(sys.stdin)
rows = d.get("rows") or []
cursor = d.get("next_cursor")
print(f"   rows returned : {len(rows)}")
print(f"   next_cursor   : {cursor!r}")
print()
if len(rows) < 1500 and cursor is None:
    print("   >>> TRUNCATED WITH NO CURSOR: the caller has no way to detect this,")
    print("   >>> and no way to retrieve the remainder. The response is")
    print("   >>> indistinguishable from a complete one.")
elif len(rows) < 1500:
    print("   >>> truncated, cursor offered — see step 4 for whether it works")
else:
    print("   >>> not reproduced on this build")
PY

echo
echo "4. following the cursor, if one was offered"
printf '%s' "${RESP}" | python3 - <<'PY' > /tmp/.rowcap-cursor
import json, sys
d = json.load(sys.stdin)
print(d.get("next_cursor") or "")
PY
CURSOR=$(cat /tmp/.rowcap-cursor); rm -f /tmp/.rowcap-cursor
if [ -z "${CURSOR}" ]; then
  echo "   no cursor was returned."
else
  echo "   cursor: ${CURSOR}"
  curl -sS --max-time 60 "${ENDPOINT}/v1/graphs/${GRAPH}/query" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "X-Graph-Namespace: ${GRAPH}" \
    -H 'Content-Type: application/json' \
    --data "$(printf '{"cell_id":"%s","cursor":"%s"}' "${CELL}" "${CURSOR}")" \
    | head -c 600
  echo
fi

echo
echo "5. paging parameters — are they honoured or ignored?"
for variant in 'LIMIT 2000' 'SKIP 1024 LIMIT 500'; do
  printf '   %-22s ' "${variant}"
  q "MATCH (n:${LABEL}) RETURN n.i ${variant}" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(f"rows={len(d.get(chr(114)+chr(111)+chr(119)+chr(115)) or [])}")' 2>/dev/null \
    || echo "rejected"
done

echo
echo "done (probe nodes deleted)"
