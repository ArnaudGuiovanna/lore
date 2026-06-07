# LORE Frontend — Architecture & Shared Contract

Real Next.js frontend for the LORE **headless LMS**, connected to the Go backend, implementing the
**LECTURE** design direction and the three role journeys from our research.

## Stack
- **Next.js (App Router) + TypeScript + React**, `next/font` for the LECTURE typefaces. No Tailwind —
  hand-crafted CSS with LECTURE design tokens (CSS variables) to preserve the bespoke aesthetic.
- Server Components fetch backend data; **Route Handlers** (`app/api/.../route.ts`) proxy mutations.
- Backend: Go server at `http://127.0.0.1:8080` (open local mode for dev). Seed: `web/scripts/seed.sh`
  writes IDs to `web/.gen/seed.json` (also exported via env in `lib/config.ts`).

## Headless discipline (do NOT violate)
- The frontend **consumes API state**; it never re-implements pedagogy. The **runtime owns progression**;
  the LLM only generates content from a TutorInstruction. Always distinguish **runtime-decided** vs
  **LLM-generated**. Evidence over vanity metrics. The UI must work under instruction-only fallback.
- Roles: LEARNER / TRAINER / TENANT_ADMIN / SUPER_ADMIN — role is **derived from membership**.
- **Syllabus is trainer-owned** (intent: title/description/objectives/outcomes; NO courses/resources).
  Trainer attaches a cohort (binding, adaptation_mode GUIDED) → runtime+LLM generate the parcours.
  Syllabi are append-only (edit = fork a new version + rebind). Admin does NOT own syllabi.

## Design tokens (LECTURE) — defined in `app/globals.css`, do not redefine
- Paper `--paper:#f6f2ea`, ink `--ink:#23211b`, accent ink-green `--accent:#2a4f3e`,
  oxblood alarm `--alarm:#7c2531`, amber `--amber:#9a6a16` (instruction-only/fallback).
- Fonts: **Newsreader** (reading serif, body hero), **Fraunces** (display/standfirst/wordmark),
  **Spline Sans Mono** (marks, code, IDs, metrics). Loaded via `app/layout.tsx` (next/font/google).
- Marks: `.mark.runtime` (accent), `.mark.llm` (soft green), `.mark.fallbk` (amber). Calm motion,
  `prefers-reduced-motion` guard, `:focus-visible` rings, ~58–68ch reading measure for prose.

## Directory layout (shared contract)
```
web/
  app/
    layout.tsx                 # fonts + globals + html shell
    globals.css                # LECTURE tokens + primitives
    page.tsx                   # login / role entry (role derived after "sign in")
    (learner)/learner/...      # LEARNER surface (reading workbench, provenance, reviews, progress, history)
    (trainer)/trainer/...      # TRAINER surface (syllabus authoring+versions, cohort, alerts, inspection)
    (admin)/admin/...          # TENANT_ADMIN surface (identity, structure, domain graph, LLM matrix, outbox)
    api/                       # route handlers proxying backend mutations
  components/                  # shared LECTURE primitives (Mark, Panel, Stepper, Reading, CodeBlock, ...)
  lib/
    config.ts                  # backend base + seeded IDs (env + .gen/seed.json)
    api.ts                     # typed fetch client (server) -> backend
    types.ts                   # backend DTO types (from openapi.yaml)
    runtime.ts                 # helpers to label runtime-decided vs llm-generated, fallback, etc.
  scripts/seed.sh
  .gen/seed.json
```

## API client contract (`lib/api.ts`)
- `api.get<T>(path)`, `api.post<T>(path, body, {idempotencyKey})`, `api.put`, `api.patch`.
- Tenant-scoped helpers take the active tenant id from `lib/config.ts`.
- All calls server-side (never expose backend directly to the browser); mutations via route handlers.

## Build order (phases, iterated via workflows)
1. **Foundation** (this scaffold): tokens, fonts, api client, types, app shell, login/role entry. ✅ build green.
2. **Learner surface** — Now reading loop (activities/next → generate/instruction-only → evidence →
   state delta), provenance (cohort→syllabus→objective/outcome, read-only), reviews/due, progress
   (state), history (snapshots).
3. **Trainer surface** — syllabus authoring (create), attach cohort (bind), generated parcours,
   versions (fork)+rebind(review-state), cohort health (analytics), alerts (+patch), learner inspection
   (snapshots).
4. **Admin surface** — identity/memberships, structure (programs/cohorts), domain graph, LLM config
   matrix (scopes, resolution), event outbox.
5. **Integration + tests + verify** — Playwright smoke per surface, fix, design-alignment review.

## Done = 
All three role surfaces navigable from login, wired to the live backend with real seeded data,
LECTURE-consistent, runtime-first, build green, Playwright smoke green per surface.
