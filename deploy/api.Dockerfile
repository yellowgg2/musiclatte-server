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

FROM node:24.20.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
RUN mkdir /management /keys && chown node:node /management /keys && chmod 700 /management /keys
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/config/container-entry.js"]
