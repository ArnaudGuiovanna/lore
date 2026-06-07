# LORE — the LECTURE front

A self-hostable web front for **LORE**, a headless, runtime-first, AI-first LMS.
This Next.js app (the **LECTURE** design language: warm paper, ink-green accent,
serif typography) is the operator/learner UI on top of the LORE Go backend.

LORE is not a content-first LMS. The **pedagogical runtime owns progression** —
concept selection, mastery, review scheduling, assessment readiness, misconception
detection, alerts, and audit. The LLM only **generates content from runtime
instructions**; it never decides progression. Syllabi are **trainer-owned**;
admins manage tenants, people, and policy but do **not** own syllabi.

This guide is for a training organization (OF) that wants to run LORE itself.

---

## What is and isn't implemented

**Implemented:** tenant isolation (RBAC enforced by the backend), real bearer-JWT
auth, programs/cohorts/enrollments, trainer-owned syllabi + concept-DAG domains,
the pedagogical runtime (next-activity selection, mastery, reviews, misconceptions,
alerts), events, and the LECTURE UI for learner / trainer / admin areas.

**Not implemented (by design):** SCORM packages, classic quiz banks, discussion
forums, gradebooks. LORE replaces the "content + quiz + forum" model with an
**AI-first runtime**: the runtime drives what each learner does next, and content
is generated to instruction. If you need SCORM/forums, LORE is not a fit.

---

## Architecture

```
Browser ──HTTPS──> Next.js (LECTURE)  ──server-side bearer JWT──> LORE Go backend
                   - sessions (cookie)                            - tenants / RBAC
                   - credential store (passwords)                 - pedagogical runtime
                   - mints per-user LORE tokens                   - events / audit
```

- The browser **never** talks to the backend directly. The Next server holds the
  operator bootstrap secret, verifies the user's password, mints a **per-user LORE
  bearer token** (role + tenant come from the backend membership), and attaches it
  to `/v1/tenants/...` calls. RBAC is enforced **end-to-end by the backend**.
- The backend owns identity (users, memberships, roles) but **not passwords**. The
  front keeps password hashes (bcrypt) in a file-backed credential store.

---

## Prerequisites

- **Docker + Docker Compose** (quick start), **or**
- **Node.js 22+** and **Go 1.25+** for a local non-Docker run.
- `bash`, `curl`, and `jq` to run the seed script (`web/scripts/seed.sh`).

---

## Quick start (Docker)

From the **repo root**:

```bash
# 1. Generate real secrets (do NOT keep the defaults).
export JWT_SECRET=$(openssl rand -hex 32)
export LORE_BOOTSTRAP_TOKEN=$(openssl rand -hex 24)
export SESSION_SECRET=$(openssl rand -hex 32)

# 2. Build + run the backend, seed demo data, and start the web front.
docker compose -f deploy/docker-compose.web.yml up --build
#   ... or:  make docker-up
```

This starts three things:

| service | role |
|---------|------|
| `lore`  | the Go backend, **JWT mode**, in-memory store (zero external deps) |
| `seed`  | one-shot: runs `web/scripts/seed.sh` once the backend is up |
| `web`   | the LECTURE front on **http://localhost:3001** |

Open **http://localhost:3001** and sign in with a demo account below.

> The in-memory store **resets on restart**. For a durable, multi-node deployment
> use `deploy/docker-compose.yml` (Postgres + Redis + NATS) and point this front's
> `LORE_BASE` at that backend — see "Point at a real backend" below.

### Re-seeding

The `seed` service runs once. To re-seed after the backend restarts:

```bash
LORE_BASE=http://127.0.0.1:8080 LORE_BOOTSTRAP_TOKEN=$LORE_BOOTSTRAP_TOKEN \
  bash web/scripts/seed.sh
#   ... or:  make seed
```

---

## Quick start (local, no Docker)

```bash
# terminal 1 — backend (JWT + in-memory)
make run-backend JWT_SECRET=$JWT_SECRET LORE_BOOTSTRAP_TOKEN=$LORE_BOOTSTRAP_TOKEN

# terminal 2 — seed demo data
make seed LORE_BOOTSTRAP_TOKEN=$LORE_BOOTSTRAP_TOKEN

# terminal 3 — web front
cd web
cp .env.example .env.local      # then edit the secrets to match
npm install
npm run dev                     # http://localhost:3001
```

---

## Demo accounts

The seed creates these users (with backend memberships/roles). On first boot the
front derives **friendly login emails** and sets every demo account's password to
`DEFAULT_SEED_PASSWORD` (default `lore123!`).

| Login email         | Role          | Area      |
|---------------------|---------------|-----------|
| `admin@acme.test`   | TENANT_ADMIN  | `/admin`  |
| `trainer@acme.test` | TRAINER       | `/trainer`|
| `amara@acme.test`   | LEARNER       | `/learner`|
| `diego@acme.test`   | LEARNER       | `/learner`|
| `liam@acme.test`    | LEARNER       | `/learner`|
| `noor@acme.test`    | LEARNER       | `/learner`|

Password (all demo accounts): **`lore123!`** (or your `DEFAULT_SEED_PASSWORD`).

### Changing the demo password / accounts

- **Before first boot:** set `DEFAULT_SEED_PASSWORD` to your own value. The front
  derives the demo credentials from the seeded backend users the **first time** it
  reads the credential store.
- **After first boot:** the credential store already exists at `web/.gen/users.json`
  (a Docker volume in the compose setup). Changing `DEFAULT_SEED_PASSWORD` then has
  **no effect**. To rotate, either delete `web/.gen/users.json` (or the `web-gen`
  volume) and re-seed, or change passwords programmatically via the credential store
  (`web/lib/auth/store.ts`: `setPassword(email, newPassword)` /
  `upsertCredential(...)`). Real users are normally added via invite/signup.

---

## Environment variables

(from `web/.env.example`; set these for the `web` service / in `.env.local`.)

| Variable                | Required | Default                       | Purpose |
|-------------------------|----------|-------------------------------|---------|
| `LORE_BASE`             | yes      | `http://127.0.0.1:8080`       | Server-side base URL of the LORE backend. |
| `LORE_BOOTSTRAP_TOKEN`  | yes      | `change-me-operator-secret`   | Operator secret; **must match the backend's** `LORE_BOOTSTRAP_TOKEN`. The Next server uses it to mint per-user LORE tokens. Never exposed to the browser. |
| `SESSION_SECRET`        | yes      | `change-me-...`               | Signs session cookies. Use **>= 32 bytes**. |
| `DEFAULT_SEED_PASSWORD` | no       | `lore123!`                    | Password for the seeded demo accounts (first boot only). |

Backend-side (the `lore` service): `JWT_SECRET` (signs per-user tokens),
`JWT_ALG` (default `HS256`), `LORE_BOOTSTRAP_TOKEN` (must match the front),
`STORE_DRIVER` (`memory` here; `postgres` for durability),
`LORE_LLM_PROVIDER` (`instruction_only` runs with no LLM).

---

## Auth model

1. User submits email + password to the Next server.
2. The credential store (`web/lib/auth/store.ts`) verifies the bcrypt hash and
   resolves the **LORE user id** + tenant id.
3. The server mints a **per-user bearer JWT** from the backend's `/v1/auth/token`
   (gated by `LORE_BOOTSTRAP_TOKEN`). Role and tenant are derived from the
   backend **membership**, not from the request.
4. A signed session cookie is set; `web/middleware.ts` maps role → area
   (`/learner` = LEARNER, `/trainer` = TRAINER, `/admin` = TENANT_ADMIN/SUPER_ADMIN).
5. Every backend call on `/v1/tenants/...` carries that user's token, so the
   backend enforces **RBAC and tenant isolation** itself.

---

## Point at a real / durable backend

1. Stand up the full backend stack: `docker compose -f deploy/docker-compose.yml up`
   (Postgres + Redis + NATS, persistent). Ensure it runs in **JWT mode** with a
   `JWT_SECRET` and a `LORE_BOOTSTRAP_TOKEN`.
2. Run the web front (this app) with:
   - `LORE_BASE` → your backend URL,
   - `LORE_BOOTSTRAP_TOKEN` → **matching** the backend's,
   - a strong `SESSION_SECRET`.
3. Seed (once) against that backend: `make seed LORE_BASE=... LORE_BOOTSTRAP_TOKEN=...`.

---

## Security notes

- **Change every default secret** before exposing this anywhere: `JWT_SECRET`,
  `LORE_BOOTSTRAP_TOKEN`, `SESSION_SECRET`, and `DEFAULT_SEED_PASSWORD`.
- The `LORE_BOOTSTRAP_TOKEN` is an **operator master key** (it bypasses backend
  auth to mint tokens and create memberships). Keep it server-side only; never
  ship it to the browser. It is already kept out of client bundles.
- The credential store is **file-based** (`web/.gen/users.json`), suitable for a
  **single-node** OF deployment. For scale / HA, move passwords to **Postgres**
  (swap the implementation in `web/lib/auth/store.ts`; the backend already supports
  `STORE_DRIVER=postgres` for its own state).
- Terminate TLS in front of the app (reverse proxy) for production.
- The in-memory backend store loses all data on restart — use Postgres for anything
  you need to keep.

---

## License

Apache-2.0. See the repository [`LICENSE`](../LICENSE).
