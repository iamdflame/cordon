#!/bin/sh
#
# Write the auth token to a file, then exec the engine.
#
# Also creates the store and cache directories: on a fresh volume they do not
# exist, and the engine exits rather than creating them.

set -e

: "${GRAPH_DATA_DIR:=/data}"
: "${GRAPH_AUTH_TOKEN_VALUE:?GRAPH_AUTH_TOKEN_VALUE must be set}"

mkdir -p "${GRAPH_DATA_DIR}/store" "${GRAPH_DATA_DIR}/cache"
printf '%s\n' "${GRAPH_AUTH_TOKEN_VALUE}" > "${GRAPH_DATA_DIR}/auth-token"

export GRAPH_AUTH_TOKEN_FILE="${GRAPH_DATA_DIR}/auth-token"
export LOCAL_PATH="${LOCAL_PATH:-${GRAPH_DATA_DIR}/store}"
export GRAPH_DATA_CACHE_DIR="${GRAPH_DATA_CACHE_DIR:-${GRAPH_DATA_DIR}/cache}"

echo "cordon: starting graph-node (store=${LOCAL_PATH})"
exec /usr/local/bin/graph-node "$@"
