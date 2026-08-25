#!/usr/bin/env bash
#
# What `docker compose up` runs: fetch the corpus if it is missing, build the
# sample graph, then serve the API and the console together.
#
# Deliberately the sample rather than the full corpus. The full graph is 226,357
# edges and about an hour of write-bound ingest; a judge's first run should end
# in a working console, not a progress bar.

set -euo pipefail

# Wait for the engine before touching it.
#
# This used to be a compose healthcheck on the hydradb service, which shelled
# out to `curl` - a binary that image does not ship. It failed every time, so
# `docker compose up` never got past "Container is unhealthy". Waiting here
# works because this image installs curl, and because a service should not
# depend on what happens to be inside an image it does not build.
HYDRA_URL="${HYDRA_ENDPOINT:-http://hydradb:8443}"
echo "==> waiting for HydraDB at ${HYDRA_URL}"
for attempt in $(seq 1 120); do
  if curl -sf -o /dev/null "${HYDRA_URL}/" 2>/dev/null \
    || curl -s -o /dev/null -w '%{http_code}' "${HYDRA_URL}/" 2>/dev/null | grep -qE '^[2-4]'; then
    echo "==> HydraDB is up (${attempt}s)"
    break
  fi
  if [ "${attempt}" -eq 120 ]; then
    echo "HydraDB did not come up within 120s" >&2
    exit 1
  fi
  sleep 1
done

if [ ! -d data/herb/products ]; then
  echo "==> fetching HERB"
  bash scripts/fetch-herb.sh
fi

echo "==> building the sample graph"
npm run build:graph -- --sample

echo "==> starting the API on :8787"
npm run api &
API_PID=$!

# Wait for the API to report ready rather than racing the console against it.
for _ in $(seq 1 120); do
  if curl -sf http://127.0.0.1:8787/api/health >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "==> starting the console on :5173"
cd web
npm run dev -- --host 0.0.0.0 --strictPort &
WEB_PID=$!

trap 'kill "${API_PID}" "${WEB_PID}" 2>/dev/null || true' INT TERM
wait -n "${API_PID}" "${WEB_PID}"
