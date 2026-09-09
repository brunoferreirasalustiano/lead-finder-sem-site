FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig*.json eslint.config.js ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
RUN npm ci --no-audit && npm run build

# JavaScript dependencies and compiled output are architecture-independent. Build and
# validate them on BUILDPLATFORM so multiarch images do not execute Node/npm under QEMU.
FROM build AS production-deps
RUN npm prune --omit=dev --no-audit \
  && test ! -d node_modules/glob \
  && test ! -d node_modules/tsx \
  && test ! -d node_modules/typescript \
  && test -f packages/shared/dist/index.js \
  && test -f packages/database/dist/index.js \
  && test -f packages/prospecting-orchestrator/dist/index.js \
  && test -f packages/messaging/dist/index.js \
  && test -f packages/whatsapp/dist/index.js \
  && test -f packages/batch-processor/dist/index.js \
  && test -f packages/lead-scoring/dist/index.js \
  && test -f packages/overpass-client/dist/index.js \
  && test -f packages/enrichment/dist/index.js \
  && node --input-type=module -e "await import('@lead-finder/shared'); await import('@lead-finder/enrichment'); await import('@lead-finder/messaging'); await import('@lead-finder/whatsapp'); await import('@lead-finder/database'); await import('@lead-finder/prospecting-orchestrator'); await import('@lead-finder/batch-processor'); await import('@lead-finder/lead-scoring'); await import('@lead-finder/overpass-client')"

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
USER node
WORKDIR /app
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/worker/dist ./apps/worker/dist
COPY --from=build --chown=node:node /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/packages/database/package.json ./packages/database/package.json
COPY --from=build --chown=node:node /app/packages/database/dist ./packages/database/dist
COPY --from=build --chown=node:node /app/packages/prospecting-orchestrator/package.json ./packages/prospecting-orchestrator/package.json
COPY --from=build --chown=node:node /app/packages/prospecting-orchestrator/dist ./packages/prospecting-orchestrator/dist
COPY --from=build --chown=node:node /app/packages/messaging/package.json ./packages/messaging/package.json
COPY --from=build --chown=node:node /app/packages/messaging/dist ./packages/messaging/dist
COPY --from=build --chown=node:node /app/packages/whatsapp/package.json ./packages/whatsapp/package.json
COPY --from=build --chown=node:node /app/packages/whatsapp/dist ./packages/whatsapp/dist
COPY --from=build --chown=node:node /app/packages/batch-processor/package.json ./packages/batch-processor/package.json
COPY --from=build --chown=node:node /app/packages/batch-processor/dist ./packages/batch-processor/dist
COPY --from=build --chown=node:node /app/packages/lead-scoring/package.json ./packages/lead-scoring/package.json
COPY --from=build --chown=node:node /app/packages/lead-scoring/dist ./packages/lead-scoring/dist
COPY --from=build --chown=node:node /app/packages/overpass-client/package.json ./packages/overpass-client/package.json
COPY --from=build --chown=node:node /app/packages/overpass-client/dist ./packages/overpass-client/dist
COPY --from=build --chown=node:node /app/packages/enrichment/package.json ./packages/enrichment/package.json
COPY --from=build --chown=node:node /app/packages/enrichment/dist ./packages/enrichment/dist
CMD ["node","apps/worker/dist/index.js"]
