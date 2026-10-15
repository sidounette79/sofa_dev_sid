# syntax=docker/dockerfile:1
# 21.08: pinned — this NAS's CPU lacks AVX ("sse42 popcnt" only, no AVX/AVX2).
# Bun versions after 1.3.8 have a confirmed upstream regression that
# segfaults on non-AVX2 CPUs (oven-sh/bun#30613) — hit this live tonight
# (crash dump: "CPU lacks AVX support" → SIGSEGV), which Docker's
# `restart: unless-stopped` then silently restarted, making a real crash
# look like an unpredictable multi-second "freeze" from the outside. `1-alpine`
# floats to whatever the latest 1.x is and would pull the regression right
# back in — do not bump this without confirming the regression is fixed AND
# testing on this actual CPU first.
FROM oven/bun:1.3.8-alpine AS base

# --- Prune workspace for Docker layer caching ---
FROM base AS prepare
WORKDIR /app
RUN bun add -g turbo@^2
COPY . .
RUN turbo prune @sofa/web @sofa/server --docker

# --- Install dependencies (cached by package.json + lockfile only) ---
FROM base AS deps
WORKDIR /app
COPY --from=prepare /app/out/json/ .
RUN bun install --no-save --frozen-lockfile --backend=copyfile

# --- Build ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/ .
COPY --from=prepare /app/out/full/ .

# Lingui config lives at monorepo root — turbo prune doesn't include it
COPY lingui.config.ts .

ARG APP_VERSION
ARG GIT_COMMIT_SHA
# 15.10, Sid: VITE_SENTRY_DSN is baked into the client bundle (not secret -
# a DSN only lets a client SEND events, same as any other error-reporting
# endpoint), so ARG/ENV is fine for it. SENTRY_AUTH_TOKEN is NOT - the repo
# is public, and ARG/ENV both persist in the image's layer history even in
# a stage that's never pushed, visible to anyone who can read the build
# cache. --mount=type=secret keeps it out of every layer entirely, only
# available to this one RUN step's environment (docker/build-push-action's
# `secrets:` input on the CI side, see .github/workflows/docker.yml).
ARG VITE_SENTRY_DSN
ENV NODE_ENV=production
ENV APP_VERSION=${APP_VERSION}
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}
ENV VITE_SENTRY_DSN=${VITE_SENTRY_DSN}

RUN --mount=type=secret,id=sentry_auth_token,env=SENTRY_AUTH_TOKEN \
    bunx turbo run build --filter=@sofa/web --filter=@sofa/server

# --- Production runner ---
FROM base AS runner
WORKDIR /app

# 08.10, Sid ("ça bloque TOUT le temps"): curl for emby.ts's
# embyFetchViaCurl() - a real OS subprocess timeout as a workaround for a
# confirmed Bun fetch() bug (hangs reading the response body even after
# headers arrive, immune to AbortSignal.timeout()). Not present in the base
# Alpine image by default.
# 14.10, Sid ("backup system needs a pg_dump/pg_restore-based rewrite"):
# postgresql17-client matches the db service's own postgres:17-alpine -
# pg_dump/pg_restore/psql aren't part of any base image here, and a
# mismatched client major version against a newer server can silently
# produce an incompatible dump format.
RUN apk add --no-cache curl postgresql17-client

ARG APP_VERSION
ARG GIT_COMMIT_SHA
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATA_DIR=/data
ENV APP_VERSION=${APP_VERSION}
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}

# API server + packages
COPY --from=builder --chown=bun:bun /app/apps/server/ ./apps/server/
COPY --from=builder --chown=bun:bun /app/packages/ ./packages/
COPY --from=builder --chown=bun:bun /app/node_modules/ ./node_modules/

# Built SPA
COPY --from=builder --chown=bun:bun /app/apps/web/dist/ ./apps/web/dist/

# DB migrations
COPY --from=builder --chown=bun:bun /app/packages/db/drizzle/ ./packages/db/drizzle/

RUN mkdir -p /data && chown bun:bun /data
USER bun
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD ["bun", "-e", "fetch('http://localhost:3000/api/health').then(r=>process.exit(+!r.ok)).catch(()=>process.exit(1))"]

CMD ["bun", "apps/server/src/index.ts"]

