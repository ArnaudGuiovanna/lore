# LORE — v1 MVP Backlog

> Prioritized, actionable backlog to take LORE from "demo that runs" to a **stable,
> turnkey v1 a French training organization (organisme de formation, OF) can deploy
> and run end-to-end.**
>
> LORE stays **AI-first / runtime-first**: the trainer authors a *syllabus* (intent +
> objectives + outcomes — no courses/resources), attaches a cohort, and the runtime +
> LLM generate each learner's parcours. The UI consumes API state and never
> re-implements pedagogy; it always distinguishes **runtime-decided** vs
> **LLM-generated**, and works under instruction-only fallback.
>
> **Explicitly out of scope for v1 (by design):** SCORM packages, classic quiz banks,
> discussion forums, gradebooks. LORE replaces "content + quiz + forum" with the
> runtime. Don't reintroduce them.

---

## 1. Vision & v1 Definition of Done

**Vision.** A French OF can `git clone`, set a handful of secrets, run **one command**,
and get a durable, French-language, RGPD- and Qualiopi-aware AI-first LMS where the
whole training loop closes — from org creation to a downloadable completion
certificate and an exportable audit trail.

**v1 is DONE when this end-to-end loop works on a fresh machine, in French, durably:**

1. **Deploy** — `docker compose up` (one file) brings up backend + **Postgres**
   (durable) + web + reverse proxy/TLS, all with healthchecks. No data loss on
   restart.
2. **First-run setup** — an operator opens the app, runs a **setup wizard**: creates
   the organization (tenant) + the first **admin** account (no seed/demo creds in
   prod). The system is empty, not pre-seeded.
3. **Invite people** — admin invites **trainers** and **learners** (email invitation
   with a token link); they set their own password on first login.
4. **Author** — a **trainer** authors a **syllabus** (intent/objectives/outcomes),
   defines/links a concept domain, and **attaches a cohort** (binding). The runtime is
   ready to generate the parcours.
5. **Learn** — **learners** follow the runtime-generated parcours (next-activity →
   instruction-only or LLM-generated content → evidence → mastery/review/snapshot
   updates). Provenance (cohort → syllabus → objective) is visible.
6. **Track** — progress, mastery, reviews due, misconceptions and alerts are tracked
   and visible to trainer/learner; **attendance / émargement** is captured for
   sessions.
7. **Certify** — on completion, the learner/admin can download a **completion
   attestation / certificate (PDF)** and an **attendance sheet (PDF)**.
8. **Comply** — admin can export a learner's data (**RGPD** access/portability) and
   **erase** a learner; a **Qualiopi-friendly audit/event export** is available.
9. **Quality** — every surface has loading/empty/error states; a Playwright **smoke
   suite** proves the loop; **CI is green** (Go + web build/lint/test/e2e).
10. **French by default** — the whole UI ships in **French** (FR default, i18n-ready),
    legal/compliance documents in French.

**Non-goals for v1:** HA/multi-node clustering, SSO marketplace, billing, mobile apps,
SCORM/quiz/forum/gradebook, multi-language content authoring beyond FR/EN UI.

---

## 2. Gap Analysis

| Capability | Current state | Gap to v1 | Priority |
|---|---|---|---|
| Backend persistence | Postgres store + RLS migration exist; default deploy runs **in-memory** (resets on restart) | Make **Postgres the default** durable path in the turnkey deploy; migrations auto-run; healthchecked | **MUST** |
| Credential store (passwords) | File-backed JSON `web/.gen/users.json` (single-node, volume) | Move passwords to **Postgres** (or accept file store but make it robust + documented + backed up) | **MUST** |
| First-run onboarding | Seed-only demo (`seed.sh`, demo users) | **Setup wizard**: create org + first admin; no demo data in prod | **MUST** |
| Auth hardening | bcrypt login works; **no** password change/reset; demo creds `lore123!`; bootstrap token = operator master key | **Force password set on first login**, change/forgot password, **remove demo exposure** in prod, secret hygiene | **MUST** |
| Email (invitations / reset) | None | SMTP-based invitation + reset emails (with console/file fallback for dev) | **MUST** |
| Attendance / émargement | None | Per-session attendance capture + signature, exportable | **MUST** |
| Completion attestation / certificate | None | PDF attestation (assiduité + completion) generated from runtime state | **MUST** |
| RGPD export / delete | None | Per-learner data export (JSON/PDF) + erasure (right to be forgotten) | **MUST** |
| Qualiopi audit export | Event outbox + snapshots + audit rationale exist in backend | Expose a **traceability export** (events/snapshots) for Qualiopi review | **SHOULD** |
| i18n FR | UI is **English**; LECTURE tokens are FR-flavored but copy is EN | French default, i18n framework, FR legal copy | **MUST** |
| Turnkey deployment | Two compose files; `web` compose uses in-memory; no TLS/reverse proxy; no backups | **One** all-in-one compose: Postgres + healthchecks + reverse proxy/TLS + backups + `.env` | **MUST** |
| Stability (loading/empty/error) | Some states exist (`loading.tsx`, `error.tsx`, `not-found.tsx`); inconsistent per surface | Audit every surface for loading/empty/error/forbidden states | **MUST** |
| e2e tests / CI | Go CI green (build/vet/test+RLS); **no web lint/build/e2e in CI** | Add web build/lint + **Playwright smoke** to CI | **MUST** |
| Accessibility (RGAA/WCAG) | LECTURE has focus rings + reduced-motion; not audited | RGAA/WCAG **AA basics**: contrast, labels, keyboard, landmarks, axe in CI | **SHOULD** |
| Assessments flow | Backend has plan/submit assessment endpoints; UI thin | Surface assessment plan/submit in learner UI as part of the loop | **SHOULD** |
| Docs | Strong READMEs; no admin/deploy guide; README mixes dev & prod | Admin guide, deploy guide, README direction (dev vs OF-operator) | **SHOULD** |
| LLM provider config UX | Backend supports tenant/program/cohort/learner scopes; admin matrix exists | Keep; ensure instruction-only is the safe default in setup | **LATER** (already adequate) |

---

## 3. Backlog — EPICS → TASKS

Conventions: **Scope** = backend / frontend / deploy / docs. **Priority** =
MUST / SHOULD / LATER (for v1). **Estimate** = S (≤1d) / M (2–4d) / L (1–2w).

### EPIC A — Persistence & Durability

**Goal:** nothing important lives only in memory or in an ephemeral file.

- **T-PERSIST-1 — Postgres is the default durable backend store** · backend/deploy ·
  **MUST · M**
  Make the turnkey deploy run `STORE_DRIVER=postgres` with `LORE_AUTO_MIGRATE=on`
  against a healthchecked Postgres. Verify RLS holds in the deployed config.
  *AC:* fresh `compose up` → create tenant/user/membership → restart all services →
  data still present; RLS integration test passes against the deployed DB config.
  *Deps:* none. *Touches:* `deploy/`, `internal/store/postgres.go` (config only),
  `internal/config/config.go`.

- **T-PERSIST-2 — Durable credential store (passwords in Postgres)** · backend/frontend ·
  **MUST · L**
  Replace/extend file-backed `web/lib/auth/store.ts` with a Postgres-backed
  credential store (table owned by the web tier or a backend endpoint). Keep the
  bcrypt hashing and the same `Credential` interface so callers don't change. Add a
  migration. File store remains as a dev fallback behind a flag.
  *AC:* invite a user → set password → restart web → login still works; passwords
  never in memory-only; `store.ts` public API unchanged for callers.
  *Deps:* T-PERSIST-1. *Touches:* `web/lib/auth/store.ts`, new
  `web/lib/auth/store.pg.ts`, `db/migrations/`, `web/.env.example`.

- **T-PERSIST-3 — Backup & restore tooling** · deploy/docs · **MUST · S**
  Scripted `pg_dump`/`pg_restore` (and credential-store dump if file-based) +
  documented restore procedure; optional scheduled dump volume.
  *AC:* `make backup` produces a restorable dump; documented restore brings data back.
  *Deps:* T-PERSIST-1. *Touches:* `deploy/`, `Makefile`, `docs/deploy-guide.md`.

### EPIC B — Onboarding / First-Run Setup Wizard

**Goal:** an operator goes from empty system to a working org + admin without curl.

- **T-ONBOARD-1 — Detect first run (empty system)** · backend/frontend · **MUST · S**
  Backend endpoint or web check: is there any tenant/admin? If empty → route to setup.
  *AC:* fresh deploy redirects to `/setup`; once configured, `/setup` is locked.
  *Deps:* T-PERSIST-1. *Touches:* `web/app/setup/`, `web/middleware.ts`,
  small backend "bootstrap status" read.

- **T-ONBOARD-2 — Setup wizard: create org + first admin** · frontend/backend ·
  **MUST · M**
  Wizard collects org name/slug, admin name/email/password; uses the bootstrap token
  (server-side only) to create tenant + user + `TENANT_ADMIN` membership + credential.
  *AC:* completing the wizard logs the operator in as admin of the new org; no demo
  data created; bootstrap token never reaches the browser.
  *Deps:* T-ONBOARD-1, T-AUTH-1. *Touches:* `web/app/setup/`,
  `web/app/api/setup/route.ts`, `web/lib/auth/`.

- **T-ONBOARD-3 — Separate demo seeding from production boot** · deploy/docs ·
  **MUST · S**
  Gate `seed`/demo creds behind an explicit `LORE_DEMO=on`. Prod compose never seeds.
  *AC:* default turnkey deploy starts empty; `LORE_DEMO=on` reproduces the demo.
  *Deps:* none. *Touches:* `deploy/docker-compose*.yml`, `web/scripts/seed.sh`,
  `web/lib/config.ts`.

### EPIC C — Auth Hardening

**Goal:** safe credentials, self-service password lifecycle, no demo exposure.

- **T-AUTH-1 — Force password set/reset on first login** · frontend/backend ·
  **MUST · M**
  Invited users get a one-time token; first login forces setting a real password.
  Add a `mustResetPassword` flag in the credential record.
  *AC:* invited user cannot reach role surfaces until they set a password; flag
  clears after set.
  *Deps:* T-PERSIST-2. *Touches:* `web/lib/auth/store.ts`, `web/app/api/auth/`,
  `web/app/(auth)/set-password/`, `web/middleware.ts`.

- **T-AUTH-2 — Change password (authenticated)** · frontend/backend · **MUST · S**
  Settings action: verify current password, set new (strength rules).
  *AC:* user changes password; old fails, new works; rate-limited.
  *Deps:* T-PERSIST-2. *Touches:* `web/app/(settings)/`, `web/app/api/auth/change-password/`.

- **T-AUTH-3 — Forgot password (email reset link)** · frontend/backend · **MUST · M**
  Request reset → emailed token → set new password. Tokens single-use, expiring.
  *AC:* full reset flow works end-to-end with the email service; expired/used tokens
  rejected.
  *Deps:* T-EMAIL-1, T-PERSIST-2. *Touches:* `web/app/(auth)/forgot-password/`,
  `web/app/api/auth/reset/`, credential store.

- **T-AUTH-4 — Remove demo exposure & secret hygiene in prod** · deploy/docs ·
  **MUST · S**
  No default secrets in prod compose; refuse to boot web/backend with known-default
  `JWT_SECRET`/`SESSION_SECRET`/`LORE_BOOTSTRAP_TOKEN`; hide demo login hints unless
  `LORE_DEMO=on`.
  *AC:* booting with a default/placeholder secret in prod mode fails fast with a clear
  message; login page shows no demo creds in prod.
  *Deps:* T-ONBOARD-3. *Touches:* `internal/config/config.go`, `web/lib/config.ts`,
  `web/app/login/`, `deploy/`.

- **T-AUTH-5 — Login rate-limiting / lockout** · backend/frontend · **SHOULD · S**
  Basic throttle on login + reset endpoints.
  *AC:* repeated failures are throttled; documented.
  *Deps:* none. *Touches:* `web/app/api/auth/login/route.ts`, shared limiter util.

### EPIC D — Email (Invitations & Notifications)

- **T-EMAIL-1 — SMTP email service with dev fallback** · backend/frontend ·
  **MUST · M**
  A small mailer (web-tier) sending invitation + reset emails via SMTP env config;
  dev/test fallback writes emails to console/file. FR templates.
  *AC:* configuring SMTP sends real mail; without SMTP, emails land in a dev outbox;
  templates are French.
  *Deps:* none. *Touches:* `web/lib/email/`, `web/.env.example`, `deploy/`.

- **T-EMAIL-2 — Invitation flow uses email** · frontend · **MUST · S**
  Admin "invite user" sends an invitation email with a set-password link.
  *AC:* invited trainer/learner receives a link, sets password, lands on their surface.
  *Deps:* T-EMAIL-1, T-AUTH-1. *Touches:* `web/app/api/admin/invite/route.ts`,
  `web/components/admin/IdentityManager.tsx`.

### EPIC E — OF / France Compliance

**Goal:** the legal/operational artifacts a French OF must produce.

- **T-COMPLY-1 — Attendance / émargement model + capture** · backend/frontend ·
  **MUST · L**
  Model training *sessions* (date/time, cohort, modality) and per-learner attendance
  records with a signature capture (digital émargement). Backend persistence + tenant
  scoping; trainer/admin UI to open a session and collect signatures.
  *AC:* trainer opens a session; learners sign (or are marked present/absent);
  records persist and are tenant-isolated.
  *Deps:* T-PERSIST-1. *Touches:* `db/migrations/`, `internal/core/types.go`,
  `internal/httpapi/server.go`, `internal/store/`, `web/app/(trainer)/.../sessions/`,
  `web/app/api/sessions/`.

- **T-COMPLY-2 — Attendance sheet PDF export (feuille d'émargement)** · backend/frontend ·
  **MUST · M**
  Generate a French attendance sheet PDF per session/cohort from T-COMPLY-1 data.
  *AC:* downloadable `feuille_emargement.pdf` lists learners, dates, signatures/status,
  OF + cohort header.
  *Deps:* T-COMPLY-1, T-COMPLY-5 (PDF service). *Touches:* PDF service, `web/app/api/exports/`.

- **T-COMPLY-3 — Completion attestation / certificate PDF** · backend/frontend ·
  **MUST · M**
  Generate a French *attestation de fin de formation* / certificate from runtime
  completion + mastery state (objectives/outcomes attained, hours).
  *AC:* when a learner meets completion criteria, admin/learner downloads
  `attestation.pdf` with org, learner, syllabus objectives/outcomes, date.
  *Deps:* T-COMPLY-5, runtime state. *Touches:* PDF service, `web/app/api/exports/`,
  learner/admin UI.

- **T-COMPLY-4 — RGPD export & erasure per learner** · backend/frontend · **MUST · L**
  Export all of a learner's data (profile, states, interactions, snapshots, attendance,
  certificates) as a portable bundle; and an **erasure** action (delete/anonymize)
  honoring the right to be forgotten, including the credential record.
  *AC:* admin exports a learner bundle (JSON + human-readable PDF/HTML); erasure
  removes/anonymizes learner data across backend + credential store, leaving a
  tombstone audit event.
  *Deps:* T-PERSIST-1/2. *Touches:* `internal/httpapi/server.go`, `internal/store/`,
  `web/app/api/admin/rgpd/`, credential store.

- **T-COMPLY-5 — PDF generation service** · backend or web · **MUST · M**
  A shared PDF renderer (HTML→PDF, FR templates, OF branding header/footer) used by
  T-COMPLY-2/3 and Qualiopi export. Decide one home (web-tier renderer is simplest).
  *AC:* given structured data + a template, produces a deterministic, A4 French PDF.
  *Deps:* none. *Touches:* `web/lib/pdf/` (or `internal/pdf/`), templates.

- **T-COMPLY-6 — Qualiopi-friendly traceability export** · backend/frontend ·
  **SHOULD · M**
  Export the event outbox + pedagogical snapshots + audit rationale for a cohort/period
  as a CSV/PDF traceability pack (decisions, progression, interventions).
  *AC:* admin downloads a dated traceability export for a cohort suitable for a
  Qualiopi audit.
  *Deps:* T-COMPLY-5. *Touches:* `web/app/api/exports/qualiopi/`, uses existing
  `events/outbox` + `snapshots` endpoints.

### EPIC F — i18n (French default)

- **T-I18N-1 — i18n framework + FR/EN catalogs, FR default** · frontend · **MUST · L**
  Introduce an i18n layer (e.g. `next-intl`), extract all UI strings to FR catalogs,
  set FR as default with EN available, `lang="fr"`. **Run as a near-final pass over
  feature work to avoid churn.**
  *AC:* every visible string is translated; FR is default; no hardcoded English in
  shipped surfaces; locale switch works.
  *Deps:* feature epics substantially complete (sequence late). *Touches:* nearly all
  `web/app/**`, `web/components/**`, `web/lib/`, `web/package.json`, `web/middleware.ts`.

- **T-I18N-2 — FR legal/compliance copy + dates/numbers** · frontend/docs ·
  **MUST · S**
  French wording for certificates, attendance, RGPD, consent; `fr-FR` date/number
  formatting (`web/lib/format.ts`).
  *AC:* compliance documents and dates render in correct French formats.
  *Deps:* T-I18N-1, EPIC E. *Touches:* `web/lib/format.ts`, PDF templates, legal copy.

### EPIC G — Turnkey Deployment

- **T-DEPLOY-1 — All-in-one production compose (Postgres + healthchecks)** · deploy ·
  **MUST · M**
  One `deploy/docker-compose.prod.yml`: backend (Postgres mode) + Postgres + web,
  with healthchecks and proper `depends_on: condition: service_healthy`, named volumes,
  restart policies. Backend healthcheck on `/health`, web on its port.
  *AC:* `docker compose -f deploy/docker-compose.prod.yml up -d` yields a healthy,
  durable stack; unhealthy services don't receive traffic.
  *Deps:* T-PERSIST-1. *Touches:* `deploy/docker-compose.prod.yml`, Dockerfiles.

- **T-DEPLOY-2 — Reverse proxy + TLS** · deploy/docs · **MUST · M**
  Add Caddy (or Traefik) terminating TLS (Let's Encrypt or provided cert), proxying
  web; browser never hits backend directly (already the model). HTTP→HTTPS redirect,
  security headers.
  *AC:* `https://<domain>` serves the app with a valid cert; backend not publicly
  exposed.
  *Deps:* T-DEPLOY-1. *Touches:* `deploy/` (Caddyfile/Traefik), compose, docs.

- **T-DEPLOY-3 — One-command bootstrap + `.env` template** · deploy/docs · **MUST · S**
  `deploy/.env.example` for prod; a `make deploy` / `./deploy/up.sh` that generates
  strong secrets if missing and brings the stack up; refuses default secrets.
  *AC:* a new operator runs one command and gets a running, secured stack; missing
  secrets are generated or clearly demanded.
  *Deps:* T-DEPLOY-1, T-AUTH-4. *Touches:* `deploy/.env.example`, `deploy/up.sh`,
  `Makefile`.

- **T-DEPLOY-4 — Scheduled backups in deploy** · deploy · **SHOULD · S**
  Wire T-PERSIST-3 into the prod stack (sidecar/cron dump to a backups volume).
  *AC:* backups appear on schedule; restore documented.
  *Deps:* T-PERSIST-3, T-DEPLOY-1. *Touches:* `deploy/`.

### EPIC H — Stability & QA

- **T-QA-1 — Loading / empty / error / forbidden state audit** · frontend · **MUST · M**
  Audit every learner/trainer/admin surface; ensure consistent loading skeletons,
  empty states (esp. fresh org with no data), error boundaries, and 403 handling.
  *AC:* no surface shows a blank/broken view on empty data, slow load, or backend
  error; fresh-org empty states are intentional and guide the user.
  *Deps:* feature surfaces exist. *Touches:* `web/app/**` (per-route `loading.tsx`/
  `error.tsx`), shared empty/error components.

- **T-QA-2 — Playwright e2e smoke covering the full loop** · frontend/test · **MUST · L**
  Smoke tests: setup wizard → invite → set password → trainer authors syllabus +
  attaches cohort → learner does an activity → attendance → certificate download →
  RGPD export. Run against the docker stack.
  *AC:* `npm run test:e2e` green locally and in CI for the core loop.
  *Deps:* most MUST features. *Touches:* `web/e2e/`, `web/playwright.config.ts`,
  `web/package.json`.

- **T-QA-3 — Web build/lint/typecheck + e2e in CI** · deploy/test · **MUST · M**
  Extend `.github/workflows/ci.yml` with a web job: install, lint, typecheck, build,
  and Playwright smoke (against a compose-spun stack).
  *AC:* CI fails on web lint/type/build/e2e regressions; green on main/staging.
  *Deps:* T-QA-2. *Touches:* `.github/workflows/ci.yml`, `web/package.json`.

- **T-QA-4 — Surface assessment plan/submit in learner loop** · frontend · **SHOULD · M**
  Wire the existing `assessments/plan` + `assessments/{id}/submit` endpoints into the
  learner surface as part of the runtime loop (runtime-decided assessment activity).
  *AC:* when the runtime plans an assessment, the learner can take and submit it;
  result feeds mastery/state; clearly marked runtime-decided.
  *Deps:* none (endpoints exist). *Touches:* `web/app/(learner)/`, `web/app/api/`.

### EPIC I — Accessibility (RGAA / WCAG basics)

- **T-A11Y-1 — RGAA/WCAG AA baseline pass** · frontend · **SHOULD · M**
  Contrast checks on LECTURE tokens, form labels/aria, landmarks, keyboard nav,
  visible focus (already partly present), skip links, reduced-motion (present).
  *AC:* keyboard-only completes the core loop; labels/landmarks present; contrast
  meets AA.
  *Deps:* surfaces stable. *Touches:* `web/components/**`, `web/app/globals.css`,
  `web/app/**`.

- **T-A11Y-2 — Automated a11y checks in CI (axe)** · test · **SHOULD · S**
  Add `@axe-core/playwright` assertions to the smoke suite for key pages.
  *AC:* a11y violations on audited pages fail CI.
  *Deps:* T-QA-2, T-A11Y-1. *Touches:* `web/e2e/`, CI.

### EPIC J — Docs

- **T-DOCS-1 — OF admin guide** · docs · **SHOULD · M**
  French-leaning admin guide: setup wizard, inviting people, authoring flow overview,
  attendance, certificates, RGPD, backups.
  *AC:* an OF admin can operate LORE from this guide alone. *Touches:* `docs/admin-guide.md`.

- **T-DOCS-2 — Deploy guide** · docs · **SHOULD · M**
  Production deploy: prerequisites, `.env`, TLS/domain, backups/restore, upgrades.
  *AC:* a sysadmin deploys prod from this guide. *Touches:* `docs/deploy-guide.md`.

- **T-DOCS-3 — README direction (dev vs operator)** · docs · **SHOULD · S**
  Split "develop LORE" from "deploy LORE as an OF"; point to the two guides; remove
  demo-cred prominence; reflect Postgres-default + FR-default.
  *AC:* README clearly separates the two audiences. *Touches:* `README.md`,
  `web/README.md`.

---

## 4. Parallelization Plan for Worktrees

Goal: split the **MUST-v1** work into **file-disjoint** workstreams so agents in
separate git worktrees rarely collide. Each stream = a branch `feat/<stream>`.

> **Sequencing rules (read first):**
> - **Stream 1 (Persistence)** is foundational — its migrations + store changes
>   underlie Streams 3 and 4. Land it (or its interfaces) **first**.
> - **i18n (Stream 6)** is a **final pass** after feature work — do NOT parallelize it
>   with feature streams that add UI strings; it would churn the same files.
> - **QA/CI/e2e** integrate everyone's work — schedule **after** features stabilize.

### Stream 1 — `feat/persistence` (foundation, land first)
- **Owns:** T-PERSIST-1, T-PERSIST-2, T-PERSIST-3.
- **Touches:** `internal/config/config.go`, `internal/store/` (config only),
  `db/migrations/**`, `web/lib/auth/store.ts` (+ new `store.pg.ts`), `Makefile`
  (backup target), `deploy/` (Postgres service + healthcheck — see integration note).
- **Provides to others:** durable credential store API (unchanged interface) and a
  Postgres-backed backend.

### Stream 2 — `feat/onboarding-auth` (onboarding + auth + email)
- **Owns:** T-ONBOARD-1/2/3, T-AUTH-1/2/3/4, T-EMAIL-1/2.
- **Touches:** `web/app/setup/**`, `web/app/(auth)/**`, `web/app/api/setup/**`,
  `web/app/api/auth/**`, `web/app/api/admin/invite/route.ts`,
  `web/components/admin/IdentityManager.tsx`, `web/lib/email/**`,
  `internal/config/config.go` (secret-refusal — coordinate with Stream 1/5).
- **Depends on:** Stream 1's credential store (consume its API).

### Stream 3 — `feat/compliance` (attendance, certificates, RGPD, Qualiopi, PDF)
- **Owns:** T-COMPLY-1..6.
- **Touches:** `internal/core/types.go` (new session/attendance types),
  `internal/httpapi/server.go` (new routes), `internal/store/**` (sessions/attendance),
  `db/migrations/**` (its own new migration files), `web/lib/pdf/**`,
  `web/app/api/sessions/**`, `web/app/api/exports/**`, `web/app/api/admin/rgpd/**`,
  new trainer/admin session + export surfaces.
- **Depends on:** Stream 1 (Postgres). New backend routes/types are additive.

### Stream 4 — `feat/deploy` (turnkey deployment)
- **Owns:** T-DEPLOY-1/2/3/4 (+ consumes T-PERSIST-3 from Stream 1).
- **Touches:** `deploy/docker-compose.prod.yml`, `deploy/Caddyfile` (or Traefik),
  `deploy/.env.example`, `deploy/up.sh`, Dockerfiles, `Makefile` (deploy targets).
- **Depends on:** Stream 1 (Postgres-default). Mostly disjoint from app code.

### Stream 5 — `feat/qa` (stability, e2e, CI, assessments, a11y baseline)
- **Owns:** T-QA-1/2/3/4, T-A11Y-1/2.
- **Touches:** `web/e2e/**`, `web/playwright.config.ts`, `.github/workflows/ci.yml`,
  per-route `loading.tsx`/`error.tsx`, shared empty/error components,
  `web/app/(learner)/**` (assessment wiring), `web/app/globals.css` (a11y tokens).
- **Depends on:** features from Streams 2/3 to test — schedule its e2e/CI work **last**.

### Stream 6 — `feat/i18n` (French default) — **SEQUENTIAL, run last**
- **Owns:** T-I18N-1/2 + **T-DOCS-1/2/3**.
- **Touches:** nearly all `web/app/**` + `web/components/**` strings, `web/lib/format.ts`,
  `web/middleware.ts` (locale), `docs/**`, FR PDF templates (coordinate with Stream 3).
- **Run after** Streams 2/3/5 land their UI, to translate a stable surface in one pass.

### Integration points the coordinator MUST reconcile (shared/contended files)
- **`web/package.json` / `package-lock.json`** — Streams 2 (email), 5 (Playwright/axe),
  6 (next-intl) all add deps. Reconcile lockfile in a single merge; have each stream
  list its added deps in the PR.
- **`web/middleware.ts`** — Stream 2 (setup/auth gating) and Stream 6 (locale routing)
  both edit it. Land Stream 2's version first; Stream 6 layers locale on top.
- **`internal/config/config.go`** — Streams 1 (store default) and 2 (secret refusal)
  both touch it. Coordinate a single owner (Stream 1) and have Stream 2 add a focused
  block.
- **`db/migrations/**`** — Streams 1, 2 (credential table), 3 (sessions/attendance)
  all add migrations. Use **non-colliding sequential filenames** assigned by the
  coordinator (e.g. 000002_credentials, 000003_sessions) to avoid number clashes.
- **`internal/httpapi/server.go` route table** — Stream 3 adds routes; keep additions
  in a clearly delimited block to ease merge.
- **`deploy/**` + `.env.example`** — Streams 1 (Postgres/backup) and 4 (prod compose/
  TLS) overlap. Stream 4 owns the prod compose; Stream 1 contributes the Postgres
  service definition Stream 4 integrates.
- **`web/lib/format.ts`** — Stream 6 (fr-FR formatting) is the owner; Stream 3 should
  consume, not redefine.
- **Routing/nav** (role layouts `web/app/(*)/.../layout.tsx`) — Streams 2/3/5 add nav
  entries (setup, sessions, exports, settings). Reconcile nav in one pass.
- **`.github/workflows/ci.yml`** — Stream 5 owns the web CI job; Stream 4 may add a
  compose-up step. Single owner = Stream 5.

---

## 5. Iteration Plan (Waves)

Each wave ends on a **green build** (Go CI + web build), is pushed to **staging**, and
is **merged to main when stable**. Branch flow per repo convention: feature → staging →
main.

### Wave 1 — Foundation (durable, deployable, safe to log in)
- **Scope:** EPIC A (Persistence), EPIC B (Onboarding), EPIC C (Auth), EPIC D (Email),
  EPIC G (Turnkey deploy).
- **Streams:** `feat/persistence` (first), then `feat/onboarding-auth` + `feat/deploy`
  in parallel.
- **Exit criteria:** one-command durable deploy; first-run wizard creates org + admin;
  invite → set password → login works; no default secrets/demo in prod; data survives
  restart. Go CI green, web builds. → **staging → main**.

### Wave 2 — OF Compliance (the value an OF actually needs)
- **Scope:** EPIC E (attendance/émargement, certificates, RGPD, Qualiopi, PDF) and the
  assessment wiring (T-QA-4).
- **Streams:** `feat/compliance` (+ Stream 5 contributes T-QA-4).
- **Exit criteria:** trainer runs a session + collects émargement; attendance sheet and
  completion attestation PDFs download; RGPD export + erasure work; Qualiopi export
  available. Go + web CI green. → **staging → main**.

### Wave 3 — French, accessible, proven, documented
- **Scope:** EPIC F (i18n FR default), EPIC I (a11y), EPIC H (stability + e2e + CI),
  EPIC J (docs). **i18n runs as the final pass** over the now-stable surfaces.
- **Streams:** `feat/qa` (stability/e2e/CI/a11y), then `feat/i18n` last.
- **Exit criteria:** FR default UI; RGGA/WCAG AA basics + axe in CI; Playwright smoke of
  the full loop green in CI; admin + deploy guides published; README split. → **staging
  → main = v1**.

**v1 ships when Wave 3 merges to main with the full loop green end-to-end, in French,
durably, behind TLS.**
