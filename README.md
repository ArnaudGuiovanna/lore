# LORE

**Learning Orchestration Runtime Engine** — an open-source, **AI-first LMS** for
training organizations. A deterministic pedagogical *runtime* owns progression,
review scheduling, mastery, misconceptions, alerts, audit traces and events; LLM
providers only generate content from runtime instructions. LORE ships as a **Go
backend** (the headless runtime + REST API) **and a Next.js frontend** (the
`LECTURE` design language) with real authentication, role-based access, and the
essential LMS management an organization needs — all self-hostable.

> **Status: v1 (MVP for training organizations).** A French *organisme de
> formation* (OF) can deploy LORE in one command and run the whole training loop
> end-to-end: org + admin setup, invite people, author a syllabus + attach a
> cohort, let the runtime generate each learner's parcours, capture attendance,
> issue attestations, and handle RGPD export/erasure.

## v1 at a glance

- **Real auth & RBAC** — bcrypt login, per-user LORE JWT, roles
  (`TENANT_ADMIN`/`TRAINER`/`LEARNER`) derived from membership, enforced by the
  backend.
- **First-run setup wizard** — creates the org (tenant) + first admin; requires
  the operator bootstrap token; no demo data in production.
- **AI-first: syllabus → parcours** — a trainer authors a *syllabus* (intent +
  objectives + outcomes) and attaches a cohort; the runtime + LLM generate each
  learner's path. No course/SCORM/quiz authoring.
- **OF compliance** — completion **attestations (PDF)**, **émargement** /
  attendance sheets (PDF), **RGPD** export + erasure.
- **Durable persistence** — Postgres store (auto-migrated, RLS); durable
  credential store; backups via `make backup-db`/`restore-db`.
- **Turnkey deploy** — one-command `./deploy/up.sh` brings up Postgres + backend +
  web + **Caddy TLS**.
- **French UI** for the OF-facing surfaces; **e2e (Playwright) + CI**.

> **Not implemented (AI-first by design):** SCORM packages, classic quiz banks,
> discussion forums, gradebooks. The runtime replaces "content + quiz + forum".
> See [`docs/BACKLOG.md`](docs/BACKLOG.md) for what remains (e.g. Qualiopi export,
> accessibility audit, in-UI assessment surfacing).

## Documentation

OF-facing guides (French) and reference:

- **[Guide administrateur](docs/guide-administrateur.md)** — deploy, first-run
  setup wizard, invite trainers/learners, programs/cohorts, enrollment, LLM
  scopes, event outbox, RGPD export/erasure, backups.
- **[Guide formateur](docs/guide-formateur.md)** — the AI-first model
  (syllabus → parcours), versions/rebind, cohort health + alerts, inspecting a
  learner, émargement, attestations.
- **[Guide apprenant](docs/guide-apprenant.md)** — signing in, the
  runtime-decided parcours, evidence, reviews, progress, provenance, attestation.
- **[Guide de déploiement](docs/deploiement.md)** — turnkey self-host:
  prerequisites, one command, DOMAIN/TLS, env vars, volumes, backups, upgrades,
  **security checklist**.
- **[web/README.md](web/README.md)** — frontend (LECTURE) developer/self-host
  guide.
- **[docs/BACKLOG.md](docs/BACKLOG.md)** — v1 backlog and status.
- **[docs/product-design/](docs/product-design/)** — design research and the
  LECTURE design language realized by the frontend.

> Not a content-first Moodle clone. Instead of authoring courses, resources, SCORM
> and quizzes, a trainer **authors a syllabus** (intent + outcomes) and **attaches a
> cohort**; the runtime and the LLM **generate each learner's path**. The runtime is
> always the source of truth — the UI and the LLM never own progression.

- **Backend** — `cmd/lore`, `internal/` (Go, stdlib router). Headless runtime + REST API.
- **Frontend** — [`web/`](web/) (Next.js + TypeScript, the LECTURE design). Real login,
  roles derived from membership, RBAC, and management surfaces for learner / trainer /
  admin. **Self-host guide: [`web/README.md`](web/README.md).**
- **Design research** — [`docs/product-design/`](docs/product-design/) and the static
  mockups in [`docs/mockups/`](docs/mockups/) that the frontend realizes.

## What LORE Does

LORE owns the pedagogical state machine, runtime decisions, tenant isolation,
persistence, and events. The frontend consumes API state and never re-implements
pedagogy.

```txt
                    REST API + Auth + Events
                              |
                              v
Tenant -> Programs -> Cohorts -> Learners
                              |
                              v
Syllabi -> Domains -> Concept DAG
                              |
                              v
                    Pedagogical Runtime
                              |
          +-------------------+-------------------+
          |                   |                   |
          v                   v                   v
   Select concept       Select activity      Schedule review
   Update mastery       Detect alerts        Detect misconceptions
   Assess readiness     Persist trace        Emit events
          |
          v
                  TutorInstruction
                          |
                          v
        Ollama / OpenAI / Anthropic / Gemini / Mistral / Custom
                          |
                          v
                  Generated learner content
```

Runtime flow:

```txt
Learner state + concept graph + recent evidence
        -> deterministic pedagogical decision
        -> planned activity + TutorInstruction
        -> optional LLM-generated content
        -> learner interaction
        -> mastery/review/snapshot/alert/event updates
```

The LLM is interchangeable and never owns durable learning state. It receives a
runtime-created `TutorInstruction` and returns content only; LORE remains the
source of truth for mastery, retention, review timing, assessment completion,
alerts, and progression.

## Frontend (LECTURE) — quick start

The [`web/`](web/) app is a real, backend-connected frontend with working auth. The
fastest way to run the whole product:

```bash
# 1) backend in JWT mode (real auth on tenant routes)
go build -o /tmp/lore-server ./cmd/lore
JWT_SECRET=$(openssl rand -hex 32) LORE_BOOTSTRAP_TOKEN=$(openssl rand -hex 24) \
  PORT=8080 STORE_DRIVER=memory /tmp/lore-server &

# 2) seed real users, memberships (roles) and fixtures
LORE_BOOTSTRAP_TOKEN=<same-as-above> bash web/scripts/seed.sh

# 3) frontend
cd web && cp .env.example .env.local   # set LORE_BOOTSTRAP_TOKEN + SESSION_SECRET
npm install && npm run dev             # http://localhost:3001
```

Or run everything in containers: `docker compose -f deploy/docker-compose.web.yml up --build`
(also `make docker-up`). Full instructions, default accounts and security notes are in
[`web/README.md`](web/README.md). The `Makefile` exposes `run-backend`, `seed`, `web-dev`,
`web-build`, `web-start`, `docker-up`.

> The quick-start above uses the **in-memory** backend store, which resets on
> restart. For a durable, production-shaped deployment an OF can self-host, use the
> turnkey stack below.

## Production deploy (turnkey)

A single command brings up a durable, TLS-capable stack — **Postgres** (durable
store, auto-migrated), the **Go backend** in Postgres mode, the **web** front, and
**Caddy** terminating TLS — defined in [`deploy/docker-compose.prod.yml`](deploy/docker-compose.prod.yml).

**Prerequisites:** Docker Engine + the Docker **Compose v2** plugin (`docker compose version`),
plus `openssl` (for secret generation). A public DNS name pointing at the host is
needed only if you want automatic HTTPS.

**One command:**

```sh
./deploy/up.sh        # or:  make prod-up
```

This checks Docker, generates `deploy/.env` from `deploy/.env.example` with strong
random secrets on first run (it **never** overwrites an existing `deploy/.env`),
then `docker compose ... up -d --build`. It prints the URL and next steps.

- **No domain (local):** open `http://localhost` (Caddy on :80) or the web app
  directly on `http://localhost:3001`.
- **TLS:** set `DOMAIN=lore.example.org` in `deploy/.env`, point that DNS record at
  the host, and re-run `./deploy/up.sh`. Caddy obtains a Let's Encrypt cert
  automatically and serves `https://DOMAIN`.

**Where data lives:** the `pgdata` named volume holds the Postgres database; the
`web-gen` volume holds the frontend credential store (`.gen/users.json`, bcrypt
hashes) and seed ids. These volumes survive `make prod-down` / restarts — that is
what makes the deployment durable. Removing the volumes (`docker compose ... down -v`)
destroys all data.

**Backups:**

```sh
make backup-db                                  # pg_dump -> ./backups/lore-<timestamp>.sql.gz
make restore-db FILE=backups/lore-<timestamp>.sql.gz
```

Also back up `deploy/.env` and the durable `web-gen` volume unless the web
credential store has been moved into Postgres. The deployment guide documents a
cron-based backup routine, restore drill, and current single-node HA limits.

**Seeding (first-run only):** the `seed` service runs `web/scripts/seed.sh` once to
create a demo tenant, users/roles, a domain and runtime state, writing `seed.json`
into the `web-gen` volume. It is a **no-op on subsequent runs** (guarded by the
presence of `seed.json`), so it never clobbers real data. Run it on demand with
`make prod-seed`. For an empty production start, comment the `seed` service out (and
remove it from `web`'s `depends_on`).

**Security checklist (do before any real use):**

- Secrets in `deploy/.env` are auto-generated by `up.sh`; if you create the file by
  hand, generate them with `openssl rand -hex 32` (and `-hex 24` for the bootstrap
  token). Keep `deploy/.env` `0600` and out of git.
- **Rotate** `JWT_SECRET`, `LORE_BOOTSTRAP_TOKEN`, `LORE_METRICS_TOKEN` and
  `SESSION_SECRET` if they were ever shared or copied from an example.
- Keep `LORE_SHOW_DEMO_LOGINS=0` (the default) so seeded credentials are never shown
  on the login page in production.
- The seeded demo accounts share `DEFAULT_SEED_PASSWORD`; change it before seeding
  and have users reset their password after first login.
- Postgres is **not** published to the host (internal compose network only);
  only Caddy (80/443) is intended for public traffic. The web app's direct
  3001 port is bound to `127.0.0.1` for local diagnostics.
- Caddy sends baseline security headers (CSP, HSTS on HTTPS, anti-framing,
  `nosniff`).
- Vulnerability disclosure and supported-version policy live in
  [`SECURITY.md`](SECURITY.md).

The same `Makefile` adds `prod-up`, `prod-down`, `prod-logs`, `prod-seed`,
`backup-db`, and `restore-db` for day-to-day operation.

### Authentication & roles

Identity is verified against the LORE backend. The Next server checks a password, then
**mints a per-user LORE JWT** via the bootstrap-protected `/v1/auth/token`, stores it in a
signed httpOnly session cookie, and attaches it to every backend call — so the **backend
enforces role/tenant access** (a learner can only reach their own routes). Roles
(`TENANT_ADMIN` / `TRAINER` / `LEARNER`) are **derived from membership**, never requested by
the client, and middleware routes each role to its own surface.

For frontend product thinking, see the
[Front Product Design Workflow](docs/front-product-design-workflow.md) and
[`docs/product-design/`](docs/product-design/).

## Run (backend only)

```bash
go test ./...
PORT=8080 go run ./cmd/lore
```

PostgreSQL mode:

```bash
STORE_DRIVER=postgres \
DATABASE_URL='postgres://lore:lore@127.0.0.1:5432/lore?sslmode=disable' \
LORE_AUTO_MIGRATE=on \
LORE_MIGRATION_PATH=db/migrations \
PORT=8080 \
go run ./cmd/lore
```

PostgreSQL mode keeps the strict invariant on `tenant_id UUID`. Other business
IDs are stored as stable text identifiers so the headless API can accept
client-provided learner and concept IDs such as `learner-1` and `http-handlers`.

Health:

```bash
curl http://127.0.0.1:8080/health
```

## Authentication

When `JWT_SECRET` is unset, tenant routes are open for local development.
When `LORE_ENV` is set to `production` or another non-dev value, the server
refuses to start unless HS256 has a `JWT_SECRET` of at least 32 bytes.
When `JWT_SECRET` is set, tenant-scoped routes require `Authorization: Bearer`.

Bootstrap flow:

```bash
USER_ID=$(curl -s http://127.0.0.1:8080/v1/users \
  -H 'Content-Type: application/json' \
  -d '{"email":"trainer@example.test","name":"Trainer"}' | jq -r .id)

curl -s http://127.0.0.1:8080/v1/tenants/$TENANT_ID/memberships \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"'$USER_ID'","role":"TRAINER"}'

TOKEN=$(curl -s http://127.0.0.1:8080/v1/auth/token \
  -H 'Content-Type: application/json' \
  -d '{"tenant_id":"'$TENANT_ID'","user_id":"'$USER_ID'"}' | jq -r .access_token)
```

Then add `-H "Authorization: Bearer $TOKEN"` to tenant-scoped calls.
`TENANT_ADMIN` and `TRAINER` can manage tenant learning resources. `LEARNER`
tokens are limited to their own runtime planning, evidence submission, learner
state, reviews, and snapshots.

## LLM Providers

The runtime always creates `TutorInstruction` first. LLM providers only generate
content from that instruction.

```bash
LORE_LLM_PROVIDER=ollama   # ollama, openai, anthropic, gemini, mistral, custom
LORE_LLM_MODEL=gemma4
OLLAMA_BASE_URL=http://127.0.0.1:11434
LORE_LLM_BASE_URL=         # optional override for non-Ollama providers
LORE_LLM_API_KEY=          # required for hosted providers
```

If a provider call fails, LORE falls back to instruction-only content so the
headless runtime remains usable.

Provider configuration can also be set per tenant, program, cohort, or learner.
Tenant scope is the default; `program`, `cohort`, and `learner` scopes use
`scope_type` and `scope_id`. Generation resolves the most specific available
configuration in this order: learner, cohort, program, tenant.

```bash
curl -s http://127.0.0.1:8080/v1/tenants/$TENANT_ID/llm-configurations \
  -X PUT \
  -H 'Content-Type: application/json' \
  -d '{"provider":"instruction_only","model":"tenant-runtime","temperature":0.2,"max_tokens":512}'

curl -s "http://127.0.0.1:8080/v1/tenants/$TENANT_ID/llm-configurations?scope_type=learner&scope_id=learner-1" \
  -X PUT \
  -H 'Content-Type: application/json' \
  -d '{"provider":"instruction_only","model":"learner-runtime"}'
```

Generated content is persisted and can be listed or fetched:

```bash
curl -s "http://127.0.0.1:8080/v1/tenants/$TENANT_ID/generated-content?instruction_id=$INSTRUCTION_ID"
curl -s http://127.0.0.1:8080/v1/tenants/$TENANT_ID/generated-content/$CONTENT_ID
```

## Minimal Flow

Create a tenant:

```bash
curl -s http://127.0.0.1:8080/v1/tenants \
  -H 'Content-Type: application/json' \
  -d '{"name":"Acme Learning","slug":"acme"}'
```

Create a domain with a concept graph:

```bash
curl -s http://127.0.0.1:8080/v1/tenants/$TENANT_ID/domains \
  -H 'Content-Type: application/json' \
  -d '{
    "owner_id":"trainer-1",
    "name":"Go Backend",
    "source":"TRAINER",
    "concepts":[
      {"id":"http-handlers","name":"HTTP handlers","difficulty":0.4},
      {"id":"persistence","name":"Persistence","difficulty":0.7}
    ],
    "dependencies":[
      {"parent_concept_id":"http-handlers","child_concept_id":"persistence"}
    ]
  }'
```

Plan an activity:

```bash
curl -s http://127.0.0.1:8080/v1/tenants/$TENANT_ID/learners/learner-1/activities/next \
  -H 'Content-Type: application/json' \
  -d '{"domain_id":"'$DOMAIN_ID'"}'
```

Record evidence:

```bash
curl -s http://127.0.0.1:8080/v1/tenants/$TENANT_ID/interactions \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: interaction-learner-1-001' \
  -d '{"learner_id":"learner-1","activity_id":"'$ACTIVITY_ID'","success":true,"score":0.86}'
```

`POST /interactions` and `POST /assessments/{activity_id}/submit` accept
`Idempotency-Key`. A retry with the same key replays the first successful JSON
response and does not reapply mastery, review scheduling, snapshots, or events.

Inspect headless runtime outputs:

```bash
curl -s http://127.0.0.1:8080/v1/tenants/$TENANT_ID/learners/learner-1/state
curl -s http://127.0.0.1:8080/v1/tenants/$TENANT_ID/learners/learner-1/reviews/due
curl -s http://127.0.0.1:8080/v1/tenants/$TENANT_ID/alerts
curl -s 'http://127.0.0.1:8080/v1/tenants/$TENANT_ID/events/outbox?published=false'
```

Plan and submit an assessment:

```bash
curl -s http://127.0.0.1:8080/v1/tenants/$TENANT_ID/learners/learner-1/assessments/plan \
  -H 'Content-Type: application/json' \
  -d '{"domain_id":"'$DOMAIN_ID'"}'

curl -s http://127.0.0.1:8080/v1/tenants/$TENANT_ID/assessments/$ASSESSMENT_ACTIVITY_ID/submit \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: assessment-learner-1-001' \
  -d '{"learner_id":"learner-1","success":true,"score":0.91}'
```

## Authentication & Security

By default (no `JWT_SECRET`) the server runs in **open local mode** with no
authentication — intended for local development only. Do not expose this mode.
Set `LORE_ENV=production` for production-shaped deployments; in that mode LORE
fails closed if HS256 is selected without a strong `JWT_SECRET`.

For production set `JWT_SECRET` to enable bearer-token auth on every
tenant-scoped route, and set `LORE_BOOTSTRAP_TOKEN` to an operator secret used
to provision the first administrator:

```bash
JWT_SECRET='<random-256-bit-secret>' \
LORE_BOOTSTRAP_TOKEN='<random-operator-secret>' \
PORT=8080 go run ./cmd/lore
```

### Signing algorithm

`JWT_ALG` selects the algorithm (default `HS256`):

- **HS256** (symmetric): set `JWT_SECRET`.
- **RS256** (asymmetric): set `JWT_PRIVATE_KEY` and/or `JWT_PUBLIC_KEY` (PEM, or
  `*_FILE` paths to mounted secrets). With both keys the server issues and
  verifies tokens. With **only the public key** the server is verify-only and
  delegates issuance to an external identity provider — the **OIDC boundary**:
  `POST /v1/auth/token` returns `501 Not Implemented` and tenant routes accept
  RS256 tokens minted by the IdP. The `alg` header is enforced on every token to
  prevent algorithm-confusion attacks.

```bash
JWT_ALG=RS256 \
JWT_PUBLIC_KEY_FILE=/run/secrets/idp_public.pem \
PORT=8080 go run ./cmd/lore   # verify-only, OIDC-issued tokens
```

The trust-anchor endpoints are protected as follows:

- `POST /v1/auth/token` requires the bootstrap secret (header
  `X-LORE-Bootstrap-Token`) **or** an authorized JWT (a super-admin, a tenant
  administrator of the target tenant, or a user refreshing their own token).
  The issued role is always derived from an active membership — clients cannot
  request a role. Token lifetime is capped at 24 hours.
- `POST /v1/tenants/{tenant_id}/memberships` requires the bootstrap secret or an
  admin JWT. Only the bootstrap secret or an existing super-admin may grant the
  `SUPER_ADMIN` role; roles are validated against the known enum.

Bootstrap the first super-admin, then mint a token:

```bash
curl -s -X POST http://127.0.0.1:8080/v1/tenants/$TENANT_ID/memberships \
  -H "X-LORE-Bootstrap-Token: $LORE_BOOTSTRAP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"admin-1","role":"SUPER_ADMIN"}'

curl -s -X POST http://127.0.0.1:8080/v1/auth/token \
  -H "X-LORE-Bootstrap-Token: $LORE_BOOTSTRAP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"tenant_id":"'$TENANT_ID'","user_id":"admin-1"}'
```

**SSRF protection.** Tenant-configurable LLM base URLs are routed through a
hardened HTTP client that refuses redirects and blocks private, loopback,
link-local, and carrier-grade-NAT destinations. Provider API keys are sent as
request headers (never in the URL query string).

## Observability

Prometheus metrics are exposed at:

```http
GET /metrics
```

In production, `LORE_METRICS_TOKEN` is required and the scraper must send
`Authorization: Bearer <token>` (or `X-LORE-Metrics-Token`). Keep the backend on
a private network; the prod compose does not publish it to the host.

They include `lore_http_requests_total{method,route,status}`,
`lore_http_request_duration_seconds{method,route}`, and
`lore_http_requests_in_flight`, plus standard Go/process collectors. The `route`
label uses the matched route template (e.g. `POST /v1/tenants/{tenant_id}/memberships`)
so cardinality stays bounded.

OpenTelemetry tracing is **off by default**. Set the standard OTLP environment
variables to enable export to a collector — tracing then wraps HTTP requests and
the runtime `PlanNext` / `RecordInteraction` operations:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT='http://otel-collector:4318' \
OTEL_SERVICE_NAME='lore' \
PORT=8080 go run ./cmd/lore
```

## Current Implementation

- 100% Go server, stdlib HTTP router, no UI.
- In-memory repository for immediate local execution.
- PostgreSQL migration contract with tenant-scoped RLS under
  `db/migrations/000001_init.sql`.
- Docker Compose declares `lore`, `postgres`, `redis`, `nats`, and `ollama`.
- Runtime planner includes DAG validation, BKT mastery update, FSRS-like review
  scheduling, diagnostic assessment for missing evidence, anti-repeat concept
  selection, overload escape, active misconception repair before recall,
  deterministic activity planning, snapshots, durable alerts, and generated
  content linked to tutor instructions.
- Critical evidence mutations support durable idempotency records in memory and
  PostgreSQL.
- Failed evidence with an `error_type` persists active misconceptions; corrected
  follow-up evidence resolves them and emits the V1 misconception events.
- Alerts cover due reviews, low retention, plateau, ZPD drift, overload,
  mastery readiness, and learner risk with tenant-scoped deduplication.
- LLM configuration supports tenant, program, cohort, and learner scopes, with
  scoped provider, model, temperature, and token-limit overrides applied during
  generated content creation.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the
full text.
