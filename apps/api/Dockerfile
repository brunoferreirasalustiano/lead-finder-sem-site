FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig*.json eslint.config.js ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY database ./database
RUN npm ci && npm run build

# One-shot operational tools keep the TypeScript runner and other dev tooling.
FROM build AS tools

# Runtime images receive only production dependencies.
FROM build AS production-deps
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
USER node
WORKDIR /app
COPY --from=production-deps --chown=node:node /app/package.json ./package.json
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/database/migrations ./database/migrations
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
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
RUN test -f packages/shared/dist/index.js && test -f packages/database/dist/index.js && test -f packages/messaging/dist/index.js && test -f packages/whatsapp/dist/index.js && test -f packages/batch-processor/dist/index.js && test -f database/migrations/0001_initial.sql && node --input-type=module -e "await import('@lead-finder/shared'); await import('@lead-finder/messaging'); await import('@lead-finder/whatsapp'); await import('@lead-finder/database'); await import('@lead-finder/batch-processor')"
CMD ["node","apps/api/dist/index.js"]
