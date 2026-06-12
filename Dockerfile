# syntax=docker/dockerfile:1
# Multi-stage build: compile the React dashboard and the policy engine, then
# ship a lean runtime image where the engine serves both the API and the UI.
# Must be linux/amd64 for EigenCompute. App listens on 0.0.0.0:3100.

# ---- Stage 1: build the demo UI -------------------------------------------
FROM node:22-slim AS ui
WORKDIR /ui
COPY demo-ui/package.json demo-ui/package-lock.json* ./
RUN npm install
COPY demo-ui/ ./
RUN npm run build

# ---- Stage 2: build the policy engine -------------------------------------
FROM node:22-slim AS engine
WORKDIR /engine
COPY engine/package.json engine/package-lock.json* ./
RUN npm install
COPY engine/tsconfig.json ./
COPY engine/src ./src
RUN npm run build

# ---- Stage 3: runtime ------------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3100
WORKDIR /app

# Production deps only.
COPY engine/package.json engine/package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

# Compiled engine + immutable policy.
COPY --from=engine /engine/dist ./dist
COPY engine/policy.toml ./policy.toml

# Built dashboard, served as static files from the same origin as the API.
COPY --from=ui /ui/dist ./public

EXPOSE 3100
CMD ["node", "dist/index.js"]
