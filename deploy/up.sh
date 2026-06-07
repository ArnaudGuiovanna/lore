#!/bin/sh
# LORE — one-command turnkey bootstrap for a training organization (OF).
#
# What it does (idempotent and safe to re-run):
#   1. Checks Docker + the compose v2 plugin are available.
#   2. Creates deploy/.env from deploy/.env.example on first run, filling in strong
#      random secrets (openssl rand). It NEVER overwrites an existing deploy/.env,
#      so your secrets are stable across re-runs.
#   3. Builds and starts the production stack (Postgres + backend + web + Caddy).
#   4. Prints the URL and the next steps (logs, first admin, seeding).
#
# Usage:   ./deploy/up.sh      (or:  make prod-up)
set -eu

# Resolve paths relative to this script so it works from any CWD.
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.prod.yml"

echo "==> LORE turnkey deploy"

# 1. Preconditions ----------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed or not on PATH." >&2
  echo "       Install Docker Engine + the Compose v2 plugin, then re-run." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: the 'docker compose' (v2) plugin is not available." >&2
  echo "       Install docker-compose-plugin, then re-run." >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl is required to generate secrets." >&2
  exit 1
fi

# 2. Generate deploy/.env with strong secrets on first run ------------------
gen() { openssl rand -hex "$1"; }

if [ -f "$ENV_FILE" ]; then
  echo "==> deploy/.env already exists — leaving it (and your secrets) untouched."
else
  echo "==> Generating deploy/.env with fresh random secrets..."
  POSTGRES_PASSWORD=$(gen 32)
  JWT_SECRET=$(gen 32)
  LORE_BOOTSTRAP_TOKEN=$(gen 24)
  SESSION_SECRET=$(gen 32)

  # Start from the template, then substitute the REQUIRED empty values. Lines that
  # already have a value (e.g. DEFAULT_SEED_PASSWORD, DOMAIN) are left as-is.
  awk -v pg="$POSTGRES_PASSWORD" -v jwt="$JWT_SECRET" \
      -v boot="$LORE_BOOTSTRAP_TOKEN" -v sess="$SESSION_SECRET" '
    /^POSTGRES_PASSWORD=$/     { print "POSTGRES_PASSWORD=" pg;       next }
    /^JWT_SECRET=$/            { print "JWT_SECRET=" jwt;             next }
    /^LORE_BOOTSTRAP_TOKEN=$/  { print "LORE_BOOTSTRAP_TOKEN=" boot;  next }
    /^SESSION_SECRET=$/        { print "SESSION_SECRET=" sess;        next }
    { print }
  ' "$ENV_EXAMPLE" > "$ENV_FILE"

  chmod 600 "$ENV_FILE"
  echo "==> Wrote deploy/.env (0600). Secrets generated for POSTGRES_PASSWORD,"
  echo "    JWT_SECRET, LORE_BOOTSTRAP_TOKEN, SESSION_SECRET."
  echo "    Edit deploy/.env to set DOMAIN (for TLS) and DEFAULT_SEED_PASSWORD."
fi

# 3. Build + start ----------------------------------------------------------
echo "==> Building and starting the stack (this can take a few minutes on first run)..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

# 4. Report -----------------------------------------------------------------
# Read DOMAIN back from the generated env for the URL hint (without leaking secrets).
DOMAIN=$(awk -F= '/^DOMAIN=/{print $2}' "$ENV_FILE" 2>/dev/null || true)

echo ""
echo "==> LORE is starting. Useful commands:"
if [ -n "${DOMAIN:-}" ]; then
  echo "    URL:        https://$DOMAIN   (Caddy obtains a TLS cert automatically)"
else
  echo "    URL:        http://localhost   (via Caddy on :80)"
  echo "                http://localhost:3001   (web app directly)"
  echo "    TLS:        set DOMAIN=your.host in deploy/.env, point DNS at this server,"
  echo "                then re-run ./deploy/up.sh for automatic HTTPS."
fi
echo "    Logs:       make prod-logs        (docker compose -f deploy/docker-compose.prod.yml logs -f)"
echo "    Re-seed:    make prod-seed        (first-run demo data; safe no-op if already seeded)"
echo "    Backups:    make backup-db        (pg_dump to ./backups/)"
echo ""
echo "    First login: demo accounts are seeded with DEFAULT_SEED_PASSWORD from deploy/.env."
echo "    Have users change it after first login. Set LORE_SHOW_DEMO_LOGINS=0 (default) for prod."
echo ""
echo "==> Done."
