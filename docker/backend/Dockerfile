# EdgeFlow Backend Dockerfile - multi-stage, non-root

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache curl
RUN addgroup -g 1001 -S nodejs && adduser -S edgeflow -u 1001 -G nodejs
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=edgeflow:nodejs . .
USER edgeflow
ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fs http://localhost:4000/health || exit 1
CMD ["node", "src/server.js"]
