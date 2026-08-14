FROM node:22-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.production.json ./
RUN npm ci
COPY src ./src
RUN npm run build:production && npm prune --omit=dev

FROM node:22-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8788 \
    REVIEW_LIVE=1 \
    REVIEW_DATA_ROOT=/data \
    RUNS_FILE=/data/control/runs.json \
    REVIEW_DURABILITY_ROOT=/data/durability \
    REVIEW_CREDENTIAL_ROOT=/data/credentials

WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /data && chown -R node:node /data

USER node
VOLUME ["/data"]
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8788/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/production.js"]
