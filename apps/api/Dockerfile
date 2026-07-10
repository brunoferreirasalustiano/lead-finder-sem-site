FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig*.json eslint.config.js ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
RUN npm ci && npm run build
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
USER node
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/packages ./packages
CMD ["node","apps/api/dist/index.js"]
