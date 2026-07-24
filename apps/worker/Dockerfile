FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig*.json eslint.config.js ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
RUN npm ci && npm run build

# Runtime images receive only production dependencies.
FROM build AS production-deps
RUN npm prune --omit=dev

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
RUN test -f packages/shared/dist/index.js && test -f packages/database/dist/index.js && test -f packages/messaging/dist/index.js && test -f packages/whatsapp/dist/index.js && test -f packages/batch-processor/dist/index.js && test -f packages/lead-scoring/dist/index.js && test -f packages/overpass-client/dist/index.js && node --input-type=module -e "await import('@lead-finder/shared'); await import('@lead-finder/messaging'); await import('@lead-finder/whatsapp'); await import('@lead-finder/database'); await import('@lead-finder/batch-processor'); await import('@lead-finder/lead-scoring'); await import('@lead-finder/overpass-client')"
CMD ["node","apps/worker/dist/index.js"]
