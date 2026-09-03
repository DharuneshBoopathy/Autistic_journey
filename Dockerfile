# The archive ships as one image running two different processes: the web app and
# the derivative worker. They share every dependency, so building them separately
# would duplicate a hundred megabytes to save nothing.
#
#   web     node server.js              (Next's standalone output)
#   worker  node dist/worker/index.mjs  (bundled by scripts/build-worker.mjs)
#
# Debian slim rather than Alpine, deliberately: `sharp` and `@node-rs/argon2` are
# native modules with prebuilt binaries for glibc. Alpine's musl means either a
# source build in the image or a subtly different libvips, and neither is worth the
# 40MB.

# --- Dependencies -------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` from the lockfile: a deployment must install what was tested, not
# whatever the registry offers today.
RUN npm ci

# --- Build --------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `env.ts` skips its deployment checks during the build phase, so this needs no
# real configuration — and must not have any, since build arguments are readable
# in the image history.
RUN npm run build && npm run build:worker

# --- Production dependencies --------------------------------------------------
# A second, clean install with no dev dependencies: no compiler, no test runner and
# no migration tooling sitting next to the archive at runtime.
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- Runtime ------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as a non-root user. The image ships one, and using it means a container
# escape starts from an unprivileged account.
RUN groupadd --system --gid 1001 archive \
 && useradd --system --uid 1001 --gid archive archive

# The production tree first, then the standalone bundle on top.
#
# Order matters: Next traces the exact subset of node_modules the app reaches and
# ships it inside `standalone`, while the worker bundle needs packages the app
# never imports. Copying the full tree first and letting the traced copy overwrite
# it keeps Next's version of anything they share, and leaves the extras the worker
# needs alongside.
COPY --from=prod-deps --chown=archive:archive /app/node_modules ./node_modules
COPY --from=build --chown=archive:archive /app/.next/standalone ./
COPY --from=build --chown=archive:archive /app/.next/static ./.next/static
COPY --from=build --chown=archive:archive /app/dist ./dist

# Migrations are applied by the operator, not by a container starting up — two
# instances rolling out at once would otherwise race each other through the same
# migration. `drizzle/` is here so `node dist/db/migrate.mjs` can be run as a job.
COPY --chown=archive:archive drizzle ./drizzle

USER archive
EXPOSE 3000

# Answers only "is this instance able to serve", and deliberately nothing else.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
