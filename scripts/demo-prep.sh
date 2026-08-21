#!/usr/bin/env bash
#
# Get this machine ready to record the demo.
#
#   bash scripts/demo-prep.sh
#
# Recording goes wrong for boring reasons: a container that was not running, an
# audit that spends its first two minutes building a graph while the camera
# rolls, an API that was never started. This does all of that first, so that
# every command in docs/DEMO.md prints its answer immediately when you run it
# on camera.
#
# Safe to run more than once. It changes nothing in the repository.

set -uo pipefail

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RED=$'\033[31m'
GOLD=$'\033[33m'; RESET=$'\033[0m'

ok()   { echo "  ${GREEN}✓${RESET} $1"; }
bad()  { echo "  ${RED}✗${RESET} $1"; }
warn() { echo "  ${GOLD}!${RESET} $1"; }
step() { echo; echo "${BOLD}$1${RESET}"; echo "${DIM}$(printf '%.0s-' {1..70})${RESET}"; }

FAILED=0

step "1. Tools"

for tool in docker node npm; do
  if command -v "$tool" >/dev/null 2>&1; then
    ok "$tool $("$tool" --version 2>/dev/null | head -1)"
  else
    bad "$tool is not installed"
    FAILED=1
  fi
done

if [ "$FAILED" = "1" ]; then
  echo
  echo "${RED}Install the missing tools first.${RESET}"
  exit 1
fi

step "2. The corpus"

if [ -d data/herb ] && [ -n "$(ls -A data/herb 2>/dev/null)" ]; then
  ok "data/herb present ($(du -sh data/herb 2>/dev/null | cut -f1))"
else
  warn "data/herb missing — fetching (~28MB, one time)"
  bash scripts/fetch-herb.sh || { bad "fetch failed"; exit 1; }
  ok "corpus fetched"
fi

step "3. HydraDB"

if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^hydradb$'; then
  ok "hydradb already running"
else
  warn "starting hydradb"
  bash scripts/hydra-up.sh >/dev/null 2>&1 || { bad "hydra-up failed"; exit 1; }
  ok "hydradb started"
fi

step "4. Warming the audits"

echo "${DIM}  Each audit builds the graph before it prints. Running them once now${RESET}"
echo "${DIM}  means they answer immediately when you run them on camera.${RESET}"
echo

warm() {
  local label="$1"; shift
  printf "  %s %-34s" "${DIM}...${RESET}" "$label"
  if timeout 1800 "$@" >/dev/null 2>&1; then
    printf "\r  ${GREEN}✓${RESET} %-34s ${DIM}warm${RESET}\n" "$label"
  else
    printf "\r  ${RED}✗${RESET} %-34s ${DIM}failed — run it by hand to see why${RESET}\n" "$label"
    FAILED=1
  fi
}

warm "npm run audit:inference"  npx tsx src/bench/inference.ts
warm "npm run audit:planner"    npx tsx src/bench/planner.ts
warm "npm run audit:policy"     npx tsx src/bench/policy.ts
warm "npm run audit:llm"        npx tsx src/bench/llm-adversary.ts

step "5. The API"

if curl -s -m 3 localhost:8787/api/health >/dev/null 2>&1; then
  ok "API already up on :8787"
else
  warn "starting the API on the GitHub corpus (fast to ingest)"
  CORDON_CORPUS=github nohup npx tsx src/api/server.ts >/tmp/cordon-demo-api.log 2>&1 &
  for _ in $(seq 1 60); do
    sleep 2
    if curl -s -m 3 localhost:8787/api/health 2>/dev/null | grep -q '"ok":true'; then
      ok "API up on :8787  ${DIM}(log: /tmp/cordon-demo-api.log)${RESET}"
      break
    fi
  done
  curl -s -m 3 localhost:8787/api/health >/dev/null 2>&1 || {
    bad "API did not come up — check /tmp/cordon-demo-api.log"
    FAILED=1
  }
fi

step "6. Ready to record"

if [ "$FAILED" = "1" ]; then
  echo "  ${RED}Something above failed. Fix it before you record.${RESET}"
  echo
  exit 1
fi

cat <<READY
  ${GREEN}Everything is warm.${RESET} Every command below now prints immediately.

  ${BOLD}Windows to open before you hit record${RESET}
    A   this terminal, ${BOLD}big font${RESET} (Ctrl+Shift+plus, six times)
    B   http://localhost:5173        ${DIM}the console (run: cd web && npm run dev)${RESET}
    C   docs/INFERENCE.md on GitHub  ${DIM}for the phantom table${RESET}

  ${BOLD}The eight shots, in order${RESET}
    1   console, Ask tab, click a withheld fact
    2   console, same question as two different people
    3   ${BOLD}npm run audit:inference${RESET}    ${DIM}<- the money shot${RESET}
    4   scroll up to the depth table
    5   ${BOLD}npm run audit:planner${RESET}
    6   ${BOLD}npm run audit:llm${RESET}
    7   the policy-preview curl        ${DIM}(in docs/DEMO.md, shot 7)${RESET}
    8   console, Disclosure budget + Risk surface tabs

  ${DIM}Full script, timings and voiceover: docs/DEMO.md${RESET}

READY
