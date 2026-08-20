# The Cordon API, for the hosted deployment.
#
# Serves the GitHub corpus: 8 real repositories, 11 nested teams, 405 edges.
# That ingests in about a minute on a cold container, where the full HERB graph
# is 226,357 edges and over an hour of write-bound ingest — so HERB is built
# locally and re-attached, and the hosted instance runs the corpus whose whole
# point is that its permissions were fetched rather than modelled.
#
# Build context is the repository root.
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm i -D tsx typescript

# Only what the API needs. The web console is served from Vercel, and the HERB
# corpus is not used in this mode.
COPY tsconfig.json ./
COPY src ./src
COPY fixtures ./fixtures

ENV NODE_ENV=production
ENV CORDON_CORPUS=github
ENV HOST=0.0.0.0

EXPOSE 8787
CMD ["npx", "tsx", "src/api/server.ts"]
