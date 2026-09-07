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
COPY apps/web/index.html apps/web/vite.config.ts apps/web/tsconfig.json ./apps/web/
COPY apps/web/public ./apps/web/public
COPY apps/web/src ./apps/web/src
RUN npm run build -w @musiclatte/contracts && npm run build -w @musiclatte/web

FROM nginx:1.28.0-alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY deploy/gateway.conf /etc/nginx/musiclatte.conf.template
COPY deploy/gateway-entry.sh /usr/local/bin/gateway-entry.sh
USER nginx
EXPOSE 8080
ENTRYPOINT ["sh", "/usr/local/bin/gateway-entry.sh"]
