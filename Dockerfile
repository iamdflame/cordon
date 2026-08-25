# Cordon: the pipeline, the API and the console in one image.
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a source edit does not re-resolve the tree.
COPY package.json package-lock.json ./
RUN npm ci
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

COPY . .

# Bind to all interfaces, or the published port reaches nothing.
#
# The API defaults to 127.0.0.1, which is correct on a laptop and wrong in a
# container: `ports: ['8787:8787']` forwards to the container's external
# interface, and a server listening only on loopback never sees it. The console
# worked anyway because Vite proxies /api internally, so the failure was
# invisible from the browser and total from curl, the SDK, and the CLI.
ENV HOST=0.0.0.0

EXPOSE 8787 5173
CMD ["bash", "scripts/compose-entrypoint.sh"]
