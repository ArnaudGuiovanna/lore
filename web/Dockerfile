# syntax=docker/dockerfile:1
# Multi-stage build for the LORE web front (LECTURE design language).
# Produces a slim runtime image that runs the Next.js standalone server.
# Requires next.config.mjs to set `output: 'standalone'`.

# --- deps: install production + build dependencies ---
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- builder: compile the Next.js app ---
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# LORE_BASE is read at runtime by the server; a placeholder keeps the build hermetic.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- runner: minimal runtime image ---
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

# Run as a non-root user.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# The standalone output bundles only the files needed to run `node server.js`.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# The credential store + seed ids are written under .gen at runtime; make it writable.
RUN mkdir -p /app/.gen && chown -R nextjs:nodejs /app/.gen

USER nextjs
EXPOSE 3001

# server.js is emitted by Next.js standalone output at the bundle root.
CMD ["node", "server.js"]
