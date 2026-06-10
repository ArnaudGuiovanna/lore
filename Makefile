# LORE — convenience targets for self-hosting the backend + the LECTURE web front.
#
#   make build-backend   compile the Go backend to ./bin/lore
#   make run-backend     run the backend locally in JWT + in-memory mode
#   make seed            seed demo data (tenant, users, roles, domain, syllabus, runtime)
#   make web-dev         run the web front in dev mode (hot reload) on :3001
#   make web-build       production build of the web front (standalone)
#   make web-start       run the built web front on :3001
#   make docker-up       build + run the full self-host stack with Docker Compose
#   make docker-down     stop the stack
#   make prod-up         turnkey production stack (Postgres + TLS): runs deploy/up.sh
#   make prod-down       stop the production stack (volumes preserved)
#   make prod-logs       follow production logs
#   make prod-seed       run the first-run demo seeder (safe no-op if already seeded)
#   make backup-db       pg_dump the production DB to ./backups/
#   make restore-db      restore a dump: make restore-db FILE=backups/lore-<ts>.sql.gz
#
# Secrets default to dev values; OVERRIDE them for any real deployment, e.g.
#   make run-backend JWT_SECRET=$(openssl rand -hex 32) LORE_BOOTSTRAP_TOKEN=$(openssl rand -hex 24)

LORE_BASE            ?= http://127.0.0.1:8080
JWT_SECRET           ?= local-dev-change-me-32-bytes-minimum
JWT_ALG              ?= HS256
LORE_BOOTSTRAP_TOKEN ?= boot-dev-secret
SESSION_SECRET       ?= dev-session-secret-change-me-please-32bytes-minimum
DEFAULT_SEED_PASSWORD?= lore123!

COMPOSE      = docker compose -f deploy/docker-compose.web.yml
PROD_COMPOSE = docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env
BACKUP_DIR  ?= backups

.PHONY: build-backend run-backend seed web-dev web-build web-start docker-up docker-down \
        prod-up prod-down prod-logs prod-seed backup-db restore-db

build-backend:
	go build -o bin/lore ./cmd/lore

run-backend: build-backend
	PORT=8080 \
	STORE_DRIVER=memory \
	JWT_SECRET=$(JWT_SECRET) \
	JWT_ALG=$(JWT_ALG) \
	LORE_BOOTSTRAP_TOKEN=$(LORE_BOOTSTRAP_TOKEN) \
	LORE_LLM_PROVIDER=instruction_only \
	./bin/lore

seed:
	LORE_BASE=$(LORE_BASE) \
	LORE_BOOTSTRAP_TOKEN=$(LORE_BOOTSTRAP_TOKEN) \
	bash web/scripts/seed.sh

web-dev:
	cd web && npm install && npm run dev

web-build:
	cd web && npm install && npm run build

web-start:
	cd web && npm run start

docker-up:
	$(COMPOSE) up --build

docker-down:
	$(COMPOSE) down

# --- Production (turnkey) ----------------------------------------------------
# prod-up      one-command bootstrap: generates deploy/.env (if missing) + up -d --build
# prod-down    stop the production stack (data volumes are preserved)
# prod-logs    follow logs for all production services
# prod-seed    run the one-shot demo seeder (first-run only; safe no-op otherwise)
# backup-db    pg_dump the Postgres DB to ./backups/ with a timestamp
# restore-db   restore a dump: make restore-db FILE=backups/lore-YYYYmmdd-HHMMSS.sql.gz

prod-up:
	./deploy/up.sh

prod-down:
	$(PROD_COMPOSE) down

prod-logs:
	$(PROD_COMPOSE) logs -f

prod-seed:
	$(PROD_COMPOSE) run --rm seed

backup-db:
	@mkdir -p $(BACKUP_DIR)
	@set -e; \
	. deploy/.env; \
	TS=$$(date +%Y%m%d-%H%M%S); \
	OUT=$(BACKUP_DIR)/lore-$$TS.sql.gz; \
	echo "==> Dumping database to $$OUT"; \
	$(PROD_COMPOSE) exec -T postgres pg_dump -U "$${POSTGRES_SUPERUSER:-postgres}" "$${POSTGRES_DB:-lore}" | gzip > $$OUT; \
	echo "==> Done: $$OUT"

restore-db:
	@if [ -z "$(FILE)" ]; then \
		echo "Usage: make restore-db FILE=backups/lore-YYYYmmdd-HHMMSS.sql.gz"; exit 1; \
	fi
	@set -e; \
	. deploy/.env; \
	echo "==> Restoring $(FILE) into database $${POSTGRES_DB:-lore} (existing data will be overwritten)"; \
	gunzip -c "$(FILE)" | $(PROD_COMPOSE) exec -T postgres psql -U "$${POSTGRES_SUPERUSER:-postgres}" -d "$${POSTGRES_DB:-lore}"; \
	echo "==> Restore complete"
