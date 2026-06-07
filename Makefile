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
#
# Secrets default to dev values; OVERRIDE them for any real deployment, e.g.
#   make run-backend JWT_SECRET=$(openssl rand -hex 32) LORE_BOOTSTRAP_TOKEN=$(openssl rand -hex 24)

LORE_BASE            ?= http://127.0.0.1:8080
JWT_SECRET           ?= local-dev-change-me-32-bytes-minimum
JWT_ALG              ?= HS256
LORE_BOOTSTRAP_TOKEN ?= boot-dev-secret
SESSION_SECRET       ?= dev-session-secret-change-me-please-32bytes-minimum
DEFAULT_SEED_PASSWORD?= lore123!

COMPOSE = docker compose -f deploy/docker-compose.web.yml

.PHONY: build-backend run-backend seed web-dev web-build web-start docker-up docker-down

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
