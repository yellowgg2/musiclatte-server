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

FROM node:24.20.0-bookworm-slim AS seed
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN set -eu; case "$TARGETARCH" in \
    amd64) artifact=yt-dlp_linux; hash=58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a ;; \
    arm64) artifact=yt-dlp_linux_aarch64; hash=b16e4dab368a816cd05d477d698a605a6ae87ccee1c8ffd38fa21d7254141fcc ;; \
    *) exit 1 ;; esac; \
    mkdir -p /opt/seed; \
    curl --fail --location --proto '=https' --tlsv1.2 "https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/$artifact" -o /opt/seed/yt-dlp; \
    printf '%s  /opt/seed/yt-dlp\n' "$hash" | sha256sum -c -; \
    chmod 555 /opt/seed/yt-dlp; \
    printf '{"executable":"/opt/seed/yt-dlp","version":"2026.08.19","hash":"%s"}\n' "$hash" > /opt/seed/manifest.json

FROM node:24.20.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=seed /opt/seed /opt/seed
USER node
CMD ["node", "apps/api/dist/worker-entry.js"]
