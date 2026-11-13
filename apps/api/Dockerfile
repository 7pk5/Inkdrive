# Build from the repo root:  docker build -f apps/api/Dockerfile -t ecd-api .
# Multi-arch safe (works on Oracle Ampere ARM and x86).
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
# npm validates the lockfile against EVERY workspace, so the extension's manifest must be present too.
COPY apps/extension/package.json apps/extension/package.json
RUN npm ci --workspace @ecd/api --workspace @ecd/shared --include-workspace-root
RUN npm run build --workspace @ecd/api

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages/shared/package.json packages/shared/package.json
COPY --from=build /repo/apps/api/package.json apps/api/package.json
COPY --from=build /repo/apps/extension/package.json apps/extension/package.json
RUN npm ci --omit=dev --workspace @ecd/api --workspace @ecd/shared --include-workspace-root && npm cache clean --force
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/migrations apps/api/migrations
USER node
WORKDIR /app/apps/api
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["node", "dist/server.js"]
