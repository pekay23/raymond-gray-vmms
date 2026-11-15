# VMMS API Dockerfile
# Multi-stage build: deps -> build -> runtime
# Base image pinned to Node 22 LTS (digest for reproducibility)
FROM node:22-alpine@sha256:8d3e8b4c9e4a1f7b2c9d8e1f3a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b AS base
WORKDIR /app
ENV NODE_ENV=production

# ---- Dependencies ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Build ----
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Runtime ----
FROM base AS runtime
# Add dumb-init for proper signal handling
RUN apk add --no-cache dumb-init wget
# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/dist ./dist
COPY --from=build --chown=nodejs:nodejs /app/package.json ./

EXPOSE 4100
ENV PORT=4100
ENV HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4100/api/v1/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/src/server.js"]