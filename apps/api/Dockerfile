# The API image. The build context is the repository root:
#   docker build -f apps/api/Dockerfile .          (or: npx nx docker-build api)
#
# Two stages. The builder has the whole toolchain (Nx, webpack, Prisma CLI); the runtime
# stage has only the compiled bundle and its production dependencies, no source, no
# dev dependencies and no environment file. Secrets are never baked in: they arrive as
# environment variables from Cloud Run (Secret Manager), and .dockerignore keeps every
# .env file out of the build context.

# Node 24.19.0 is the version the project already pins for EAS builds (AGENTS.md). Node 24
# is required, not a preference: jose and music-metadata are ESM-only and webpack leaves
# them as externals, so the bundle loads them with require(esm), which works from Node 22.12
# on and is the supported path in 24. An exact tag (not "24" or "lts") so a rebuild next
# month is the same Node. bookworm-slim: small, glibc, no native build needed (the pg
# adapter has no native engine, and --ignore-scripts below installs no native addon).
FROM node:24.19.0-bookworm-slim AS builder
WORKDIR /repo

# Dependencies first, so editing source does not reinstall them. --ignore-scripts: no
# package's install script runs during the build (supply-chain safety). Nx, webpack and the
# Prisma CLI work without them, because `prisma generate` is run explicitly by the Nx target
# below and needs no postinstall.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY nx.json tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/api ./apps/api

# `nx build api` runs `prisma generate` first (the generated client is git-ignored) and then
# webpack, and writes dist/apps/api/{main.js,package.json,package-lock.json}. The
# package.json is built from apps/api/package.json (@prisma/client, pg and tslib, which Nx
# cannot detect because it does not see the git-ignored generated client) plus every import
# it does detect; the lockfile is pruned from the root one, so the versions are the ones the
# repository pins (ARCHITECTURE.md section 11, item 19).
# DIRECT_URL is a placeholder: prisma.config.ts demands it even for `generate`, which never
# connects. It is set on this one RUN only, so it is in no layer's environment and not in the
# runtime stage. NX_DAEMON=false: no background process in a container.
RUN NX_DAEMON=false NX_NO_CLOUD=true DIRECT_URL=postgresql://build:build@localhost:5432/build \
    npx nx build api --outputStyle=static

FROM node:24.19.0-bookworm-slim AS runtime
WORKDIR /app

# Only the bundle and its dependency manifest. The source map is left out (stack traces then
# point at main.js; Cloud Logging is the only reader).
COPY --from=builder /repo/dist/apps/api/main.js /repo/dist/apps/api/package.json /repo/dist/apps/api/package-lock.json ./

# Production dependencies only, exactly as locked. --ignore-scripts again: nothing here needs
# a build step (the Prisma query compiler ships as JavaScript, not a native binary). The npm
# cache is removed so it is not shipped in the layer.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

# NODE_ENV=production switches on the boot-time refusals (JOB_QUEUE=local and none, plaintext
# database TLS, STORAGE_PUBLIC_URL; see env.ts). Cloud Run sends traffic to the port the
# service is configured with (8080 by default).
ENV NODE_ENV=production PORT=8080
EXPOSE 8080

# Not root: a code-execution bug in a dependency should not own the container. The `node`
# user exists in the official image. The app directory stays root-owned and read-only to it.
USER node

# Exec form, no shell and no npm wrapper: Node is PID 1 and receives SIGTERM directly, so
# the shutdown hooks (main.ts) run within Cloud Run's 10-second grace period.
CMD ["node", "main.js"]
