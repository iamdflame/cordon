#!/usr/bin/env bash
# One command to bring up everything needed for a demo.
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/hydra-up.sh

if [ ! -d fixtures/real-app/node_modules ]; then
  echo "installing fixture dependencies (they are deliberately vulnerable)"
  (cd fixtures/real-app && npm install --silent --no-audit --no-fund)
fi

echo "starting api on :8787 and web on :5173"
npx tsx src/server.ts &
API_PID=$!
trap 'kill ${API_PID} 2>/dev/null || true' EXIT
(cd web && npm run dev)
