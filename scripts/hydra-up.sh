#!/usr/bin/env bash
#
# Start a local HydraDB node for Cordon.
#
# Storage and compute are disaggregated in HydraDB; with CLOUD_PROVIDER=local
# the object store is just a directory, which is all a single-node development
# setup needs.
#
# One caveat, and it costs an hour if you meet it cold: the local object-store
# backend does not implement conditional writes
# (`PutMode::Update` is unimplemented for `LocalFileSystem`), so a node that is
# stopped and started again over an existing store accepts reads but fails every
# write with an opaque "internal query execution error". Restarting the
# container is therefore not a way to resume a build. Use `--reset` and ingest
# again, which is what this script's `--reset` flag is for.

set -euo pipefail

CONTAINER=${HYDRA_CONTAINER:-hydradb}
IMAGE=${HYDRA_IMAGE:-ghcr.io/hydra-db/hydradb:latest}
DATA_DIR=${HYDRA_DATA:-"$(pwd)/.hydra-data"}
TOKEN=${HYDRA_TOKEN:-local-development-token-32-bytes}

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but was not found on PATH" >&2
  exit 1
fi

if [ "${1:-}" = "--reset" ]; then
  echo "resetting graph storage at ${DATA_DIR}"
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
  rm -rf "${DATA_DIR}"
fi

mkdir -p "${DATA_DIR}/store" "${DATA_DIR}/cache"
printf '%s\n' "${TOKEN}" > "${DATA_DIR}/auth-token"

if docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
  echo "hydradb already running"
  exit 0
fi

docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true

docker run -d --name "${CONTAINER}" \
  --user "$(id -u):$(id -g)" \
  -p 7687:7687 -p 8443:8443 -p 9090:9090 \
  -v "${DATA_DIR}:/data" \
  -e CLOUD_PROVIDER=local \
  -e LOCAL_PATH=/data/store \
  -e GRAPH_NAMESPACE=default \
  -e GRAPH_ID=default \
  -e GRAPH_CELL_ID=cell-0 \
  -e GRAPH_CELLS=cell-0 \
  -e GRAPH_NODE_ID=node-0 \
  -e GRAPH_BOLT_NODE_ADDRESSES=node-0=127.0.0.1:7687 \
  -e GRAPH_ADVERTISED_BOLT_ADDR=127.0.0.1:7687 \
  -e GRAPH_DATA_CACHE_DIR=/data/cache \
  -e GRAPH_AUTH_TOKEN_FILE=/data/auth-token \
  -e GRAPH_ALLOW_PLAINTEXT=true \
  -e RUST_MIN_STACK=33554432 \
  "${IMAGE}" >/dev/null

printf 'waiting for hydradb'
for _ in $(seq 1 40); do
  if curl -sS --max-time 2 http://127.0.0.1:8443/v1/graphs/default/query \
      -H "Authorization: Bearer ${TOKEN}" \
      -H 'X-Graph-Namespace: default' \
      -H 'Content-Type: application/json' \
      --data '{"cell_id":"cell-0","query":"MATCH (n:__probe) RETURN count(*)"}' >/dev/null 2>&1; then
    echo
    echo "hydradb ready"
    echo "  http  http://127.0.0.1:8443"
    echo "  bolt  bolt://127.0.0.1:7687"
    exit 0
  fi
  printf '.'
  sleep 1
done

echo
echo "hydradb did not become ready; recent logs:" >&2
docker logs --tail 30 "${CONTAINER}" >&2
exit 1
