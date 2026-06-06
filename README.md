# LORE

Learning Orchestration Runtime Engine. LORE is a headless LMS where the
pedagogical runtime owns progression, review scheduling, assessment readiness,
learner state, traces, and audit decisions. LLM providers generate content from
runtime instructions only.

## Run

```bash
go test ./...
PORT=8080 go run ./cmd/lore
```

PostgreSQL mode:

```bash
STORE_DRIVER=postgres \
DATABASE_URL='postgres://lore:lore@127.0.0.1:5432/lore?sslmode=disable' \
LORE_AUTO_MIGRATE=on \
LORE_MIGRATION_PATH=db/migrations/000001_init.sql \
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

Provider configuration can also be set per tenant:

```bash
curl -s http://127.0.0.1:8080/v1/tenants/$TENANT_ID/llm-configurations \
  -X PUT \
  -H 'Content-Type: application/json' \
  -d '{"provider":"instruction_only","model":"tenant-runtime"}'
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

For production set `JWT_SECRET` to enable bearer-token auth on every
tenant-scoped route, and set `LORE_BOOTSTRAP_TOKEN` to an operator secret used
to provision the first administrator:

```bash
JWT_SECRET='<random-256-bit-secret>' \
LORE_BOOTSTRAP_TOKEN='<random-operator-secret>' \
PORT=8080 go run ./cmd/lore
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

Prometheus metrics are exposed (unauthenticated) at:

```http
GET /metrics
```

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
  selection, deterministic activity planning, snapshots, durable alerts, and
  generated content linked to tutor instructions.
- Critical evidence mutations support durable idempotency records in memory and
  PostgreSQL.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the
full text.
