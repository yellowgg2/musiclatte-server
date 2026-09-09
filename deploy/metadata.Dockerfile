FROM node:24.20.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/test-support/package.json ./packages/test-support/package.json
RUN test "$(npm --version)" = "11.19.0" && npm ci --ignore-scripts
COPY packages/contracts/src ./packages/contracts/src
COPY packages/contracts/tsconfig.json ./packages/contracts/tsconfig.json
COPY apps/api/src ./apps/api/src
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
RUN npm run build -w @musiclatte/contracts && npm run build -w @musiclatte/api

FROM build AS dependencies
RUN rm -rf node_modules && npm ci --omit=dev --ignore-scripts --workspace=@musiclatte/api --workspace=@musiclatte/contracts

FROM golang:1.26.0-bookworm@sha256:2a0ba12e116687098780d3ce700f9ce3cb340783779646aafbabed748fa6677c AS cover-projector
WORKDIR /src
COPY apps/api/helpers/cover-projection/go.mod apps/api/helpers/cover-projection/go.sum ./
RUN go mod download && go mod verify
COPY apps/api/helpers/cover-projection/main.go ./
RUN CGO_ENABLED=0 go build -mod=readonly -trimpath -ldflags='-s -w' -o /cover-projection . && \
    mkdir /notices && cp /usr/local/go/LICENSE /notices/Go-LICENSE && \
    cp /go/pkg/mod/github.com/disintegration/imaging@v1.6.2/LICENSE /notices/imaging-LICENSE && \
    cp /go/pkg/mod/golang.org/x/image@v0.41.0/LICENSE /notices/x-image-LICENSE

FROM node:24.20.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3-venv ffmpeg=7:5.1.9-0+deb12u1 && rm -rf /var/lib/apt/lists/*
COPY apps/api/helpers/requirements-metadata.lock /opt/metadata/requirements.lock
RUN python3 -m venv /opt/metadata-python && /opt/metadata-python/bin/pip install --no-cache-dir --require-hashes -r /opt/metadata/requirements.lock
# Corresponding unmodified Mutagen source and its license travel with distributed images.
RUN mkdir -p /usr/share/musiclatte/third-party && \
    python3 -c "import urllib.request; urllib.request.urlretrieve('https://files.pythonhosted.org/packages/df/70/1675da133ea92227da41bf5b24e1c66be597ff736a1533ade41da986852f/mutagen-1.48.1.tar.gz','/usr/share/musiclatte/third-party/mutagen-1.48.1.tar.gz')" && \
    echo '8f95637ab9f6f305cec6bd1294e197debe207998e3e068596563c74f86b0a173  /usr/share/musiclatte/third-party/mutagen-1.48.1.tar.gz' | sha256sum -c - && \
    tar -xOf /usr/share/musiclatte/third-party/mutagen-1.48.1.tar.gz mutagen-1.48.1/COPYING > /usr/share/musiclatte/third-party/Mutagen-COPYING
COPY THIRD_PARTY_NOTICES.md /usr/share/musiclatte/THIRD_PARTY_NOTICES.md
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY apps/api/helpers/file_access.py apps/api/helpers/metadata.py apps/api/helpers/media_fence.py ./apps/api/helpers/
RUN mkdir /management /keys && chown node:node /management /keys && chmod 700 /management /keys

FROM runtime AS api
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/config/container-entry.js"]

FROM runtime AS worker
COPY apps/api/helpers/file_transaction.py ./apps/api/helpers/
COPY --from=cover-projector /cover-projection /opt/metadata/cover-projection
COPY --from=cover-projector /notices /usr/share/musiclatte/third-party/
USER node
CMD ["node", "apps/api/dist/metadata-worker-entry.js"]
