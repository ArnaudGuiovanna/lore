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
  front keeps password hashes (bcrypt) in a **pluggable** credential store: a
  Postgres table when `DATABASE_URL` is set (durable, multi-node), or a file
  (`web/.gen/users.json`) for zero-config single-node dev. Same interface either way.

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
- **After first boot:** the credential store already exists (file `web/.gen/users.json`,
  or the `lore_web_credentials` Postgres table if `DATABASE_URL` is set). Changing
  `DEFAULT_SEED_PASSWORD` then has **no effect**. To rotate, either reset the backing
  (delete `web/.gen/users.json` / the `web-gen` volume, or truncate the table) and
  re-seed, or change passwords programmatically via the credential store
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
| `DATABASE_URL`          | no       | *(unset → file store)*        | When set, the credential store is **durable** (Postgres `lore_web_credentials` table, auto-created). When unset, passwords are file-backed at `web/.gen/users.json`. See "Credential store durability" below. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | no | *(unset → console)* | If **all five** are set, invitation emails are sent via SMTP. Otherwise the mailer logs the message (temp password + login link) to the server console (dev outbox). Port `465` uses implicit TLS; other ports negotiate STARTTLS. |

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

## First-run setup, forced reset & email

**First-run setup wizard (`/setup`).** On a fresh, un-seeded deployment there is no
admin yet. Opening the app routes the operator to **`/setup`**, a calm wizard that
collects the organization name and the first admin's name/email/password. On submit,
`POST /api/setup` creates the tenant (`POST /v1/tenants`), the admin user +
`TENANT_ADMIN` membership, and the admin credential (a real password — **no** forced
reset), persists the new tenant id into `web/.gen/seed.json` (via `writeConfig()` in
`lib/config.ts`, owner-only), mints a token, opens a session and lands on `/admin`.
Once a `TENANT_ADMIN` credential exists the wizard is **locked**: `/setup` redirects
to `/login`, and `/login` redirects to `/setup` while the system is uninitialized.
The bootstrap token never reaches the browser. The route is idempotent — it refuses
to re-init if an admin already exists.

**Forced password reset on first login.** Admin invites (`/api/admin/invite`) create
the credential with `mustChangePassword = true` and deliver a temporary password by
email (or console). On login, a flagged credential still gets a session, but it
carries a `mustChange` claim and the user is redirected to **`/account/password`**.
`middleware.ts` confines a `mustChange` session to `/account/password`,
`/api/auth/change-password` and `/api/auth/logout` until a real password is set —
`POST /api/auth/change-password` validates the new password (min 10), calls
`setPassword` + `setMustChangePassword(false)`, re-mints the session (claim cleared)
and redirects to the role home.

**Self-service change password.** Any signed-in user can change their password from
the **same `/account/password`** page; when it is *not* a forced reset, the current
password is required and verified before the change is applied.

**Email.** `web/lib/email/` is a tiny mailer: SMTP via nodemailer when the `SMTP_*`
env vars are set, otherwise a dev fallback that logs the message to the console.
Invitation emails carry the temp password + login URL, in French. Email failure
never blocks an invite (the admin still gets the temp password in the response).

---

## Credential store durability

The front holds password hashes (bcrypt) + a login-email → LORE-user-id mapping in
a **pluggable** credential store (`web/lib/auth/store.ts`), behind a single
interface (`getByEmail`, `verifyPassword`, `upsertCredential`, `setPassword`,
`setMustChangePassword`, `listCredentials`). The backing is chosen by one env var:

| `DATABASE_URL` | Backing | Use case |
|----------------|---------|----------|
| **unset** | JSON file `web/.gen/users.json` (bcrypt hashes, owner-only `0600`) | Zero-config local dev / single node. Survives restart only on a persisted volume. |
| **set** | Postgres table `lore_web_credentials` (auto-created on first use) | **Durable**: logins survive restarts and scale beyond one node. |

```bash
# Make the credential store durable:
DATABASE_URL=postgres://lore:lore@db:5432/lore  npm run start
```

On first run, **both** backings seed the demo accounts the same way (from the
seeded backend users). With Postgres, the `lore_web_credentials` table is created
with `CREATE TABLE IF NOT EXISTS` and seeded only when empty, so two web nodes can
boot against the same database safely. The credential store is independent of the
backend's own `STORE_DRIVER`; you may run a durable credential store regardless.

> Each credential carries a `mustChangePassword` flag (default `false`) and a
> `setMustChangePassword(email, value)` setter — used by the auth stream to force
> invited users to set a real password on first login.

---

## Émargement (feuilles de présence) & RGPD

The Go backend has **no attendance model**, so the web tier owns attendance and the
RGPD workflow. Both reuse the same `DATABASE_URL` switch as the credential store:
**Postgres when set** (durable, tenant-scoped, auto-created tables), **JSON-file
fallback** otherwise (`web/.gen/attendance.json`, `web/.gen/rgpd-erasures.json`,
owner-only `0600`). No extra configuration is required.

**Émargement (trainer).** A trainer opens **`/trainer/emargement`** (linked from the
trainer console), picks a session **date**, and marks each enrolled learner
**Présent / Absent**. Each mark is persisted via `POST /api/attendance` and
horodaté (the capture time is the digital émargement). The roster is the seeded
learners joined with any live `LearnerEnrolled` events for the cohort.

- **Feuille d'émargement (PDF):** `GET /api/attendance/sheet?cohort=&date=` renders a
  French A4 attendance sheet (`web/lib/pdf/attendance.ts`, **pdf-lib**) with the org
  name, cohort, date, a table of learners (présent/absent + capture time) and a
  manuscrit **signature column** for on-site sessions. The footer is honest that
  presence is captured digitally and the timestamp makes foi in distanciel.
- **Store:** `web/lib/attendance/store.ts` — table `lore_attendance`
  (`UNIQUE (tenant_id, cohort_id, learner_id, session_date)`, so re-marking is
  idempotent). Functions: `listSessions`, `getAttendance`, `markPresence`,
  `getLearnerAttendance`, `anonymizeLearnerAttendance`.

**RGPD (admin).** An admin opens **`/admin/rgpd`** (linked from the admin console) to
list tenant users and, per user:

- **Exporter les données (RGPD):** `GET /api/admin/rgpd/export?userId=` returns a
  portable JSON bundle aggregating the credential record (**without** the password
  hash), the membership/role, the learner's runtime **state / due reviews /
  snapshots / alerts** (read live from the backend, bearer-scoped), and the
  **attendance** rows.
- **Supprimer / anonymiser:** `POST /api/admin/rgpd/erase` anonymizes the credential
  (email/name → redacted, password scrambled, **row kept** for integrity) and
  re-keys the learner's attendance rows to a pseudonym, then records an **erasure
  tombstone** (`lore_rgpd_erasures`). The UI is explicit that the backend's runtime
  traces remain **pseudonymous by learner id** (no nominative data) and are kept.

Authorization: `/api/attendance*` requires **TRAINER / TENANT_ADMIN / SUPER_ADMIN**
(enforced in the route via the session role); `/api/admin/rgpd/*` requires
**TENANT_ADMIN / SUPER_ADMIN** (the `/api/admin` middleware guard plus a per-route
session check).

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

### Turnkey production stack (recommended for an OF)

For a one-command, durable, TLS-capable deployment (Postgres + backend + this web
front + Caddy), use [`deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml):

```sh
./deploy/up.sh        # or:  make prod-up
```

`up.sh` generates `deploy/.env` with strong random secrets on first run, then builds
and starts everything. Set `DOMAIN` in `deploy/.env` for automatic HTTPS. Data lives
in the `pgdata` (Postgres) and `web-gen` (credential store) volumes; back up with
`make backup-db`. See the **Production deploy (turnkey)** section of the
[root README](../README.md) for the full guide and security checklist.

---

## Security notes

- **Change every default secret** before exposing this anywhere: `JWT_SECRET`,
  `LORE_BOOTSTRAP_TOKEN`, `SESSION_SECRET`, and `DEFAULT_SEED_PASSWORD`.
- The `LORE_BOOTSTRAP_TOKEN` is an **operator master key** (it bypasses backend
  auth to mint tokens and create memberships). Keep it server-side only; never
  ship it to the browser. It is already kept out of client bundles.
- The credential store is **pluggable** (see "Credential store durability" below):
  set `DATABASE_URL` for a durable Postgres backing (passwords survive restarts and
  scale beyond one node), or leave it unset for the **file-based** backing
  (`web/.gen/users.json`), suitable for a **single-node** dev/OF deployment. Either
  way passwords are bcrypt-hashed and the file backing stays owner-only (0600).
- Terminate TLS in front of the app (reverse proxy) for production.
- The in-memory backend store loses all data on restart — use Postgres for anything
  you need to keep.

---

## License

Apache-2.0. See the repository [`LICENSE`](../LICENSE).
