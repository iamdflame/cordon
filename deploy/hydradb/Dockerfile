# HydraDB, wrapped so it can boot on a platform that injects configuration as
# environment variables rather than files.
#
# The engine reads its auth token from GRAPH_AUTH_TOKEN_FILE and has no env-var
# equivalent, so a stock container cannot start anywhere the filesystem is not
# pre-seeded. This writes the file from a variable and then hands over.
#
# Build context is the repository root (Railway uploads the whole repo), so the
# COPY path is repo-relative rather than directory-relative.
FROM ghcr.io/hydra-db/hydradb:latest

USER root
COPY deploy/hydradb/entrypoint.sh /usr/local/bin/cordon-entrypoint.sh
RUN chmod +x /usr/local/bin/cordon-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/cordon-entrypoint.sh"]
