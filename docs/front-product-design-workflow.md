# Front Product Design Workflow

This workflow defines how to reason about a frontend for LORE. LORE is not a
course catalog with a chat box attached; it is a runtime-first learning system.
The frontend must make pedagogical decisions understandable, actionable, and
safe without letting the UI or the LLM become the source of truth.

Static browser mockups are available at [mockups/index.html](mockups/index.html).

## Product Stance

Design the frontend as an operating surface for learning orchestration.

```txt
Traditional LMS front
  Course library -> lesson page -> quiz -> completion badge

LORE front
  Learner state -> runtime decision -> activity evidence -> updated model
```

The main product question is not "where do we show content?" It is:

```txt
What should this learner do now, why, what evidence will prove progress,
and what should trainers/admins do when the runtime detects risk?
```

## Design Principles

- Runtime-first: every primary learner action starts from a LORE decision, not
  from a static content list.
- Explainable orchestration: show the reason for the next activity, alert, or
  review in human language derived from runtime metadata.
- Evidence over engagement vanity: prioritize mastery, retention, confidence,
  misconceptions, reviews, assessments, and snapshots over generic progress
  bars.
- Human-in-the-loop: trainers can inspect signals and intervene, but they do
  not hand-edit mastery or review state directly.
- Headless discipline: the frontend consumes API state; it does not duplicate
  pedagogical rules client-side.
- Dense but calm operations: trainer/admin surfaces should be scannable,
  restrained, and built for repeated use.
- LLM as generator only: generated content is presented as output from a
  `TutorInstruction`, never as the authority on learner progression.

## Core Product Map

```txt
Learner UI
  Next activity
  Evidence submission
  Review queue
  State explanation

Trainer UI
  Cohort health
  Learner risk
  Misconceptions
  Alerts
  Snapshot inspection

Admin UI
  Tenants
  Users and memberships
  Programs and cohorts
  Syllabi and domain graphs
  LLM configuration scopes
```

## Workflow

### 1. Frame The Learning Job

Start each design cycle by choosing the real job, not the screen.

Inputs:

- Target user: learner, trainer, tenant admin, platform operator.
- Learning context: diagnostic, instruction, maintenance, review, assessment,
  overload recovery, misconception repair.
- Success signal: mastery change, review completion, reduced risk, resolved
  misconception, assessment readiness, cohort intervention.

Output:

- One-page product brief.
- Primary user job.
- Runtime signal that drives the screen.
- API endpoints required.
- Evidence that proves the workflow worked.

### 2. Map Runtime State To User Language

Translate backend terms into UI concepts before drawing screens.

| Backend Signal | Product Meaning | UI Treatment |
|---|---|---|
| `RuntimeDecision` | What to do next | Primary learner task |
| `TutorInstruction` | Why and how content is generated | Trainer-readable decision detail |
| `LearnerState.mastery` | Concept command | Concept status and trend |
| `LearnerState.retention` | Forgetting risk | Review urgency |
| `ReviewCard.due_at` | Retrieval timing | Review queue |
| `Alert` | Action needed | Trainer/admin triage item |
| `Misconception` | Active wrong model | Repair task and coaching context |
| `PedagogicalSnapshot` | Audit trail | Timeline and evidence drawer |
| `Event` | System activity | Ops/history feed |

Output:

- Vocabulary map.
- Screen copy rules.
- Tooltip/detail rules for runtime explanations.

### 3. Design The Learner Loop

The learner surface should be a workbench for the next best activity.

Required loop:

```txt
Load state
  -> ask LORE for next activity
  -> show generated or instruction-only content
  -> collect evidence
  -> submit interaction or assessment
  -> show what changed
  -> move to next runtime decision
```

Minimum learner screens:

- Current activity.
- Evidence submitter.
- Review queue.
- Concept state view.
- Assessment flow.
- Overload/recovery state.

Design gates:

- The learner can always see what the system wants them to do next.
- The learner can submit evidence without understanding backend concepts.
- After submission, the UI shows a concise explanation of what changed.
- If generated content fails, instruction-only content still produces a usable
  learner task.

### 4. Design The Trainer Loop

The trainer surface is not a content authoring studio first. It is an
intervention console.

Required loop:

```txt
Scan cohort health
  -> identify risk, review debt, misconceptions, plateau, overload
  -> inspect learner evidence and snapshots
  -> decide intervention
  -> track alert status
```

Minimum trainer screens:

- Cohort health dashboard.
- Learner roster with state columns.
- Alert inbox.
- Misconception board.
- Learner timeline with snapshots and events.
- Domain graph inspection.

Design gates:

- Alerts are grouped by action, not only by severity.
- A trainer can understand why a learner is at risk in under 30 seconds.
- Snapshot detail shows before, observation, after, and decision rationale.
- The UI distinguishes "runtime decided" from "LLM generated".

### 5. Design The Admin Loop

The admin surface configures the learning operating system.

Required loop:

```txt
Create tenant resources
  -> configure identity and memberships
  -> create programs/cohorts/syllabi
  -> publish domain graph
  -> configure LLM provider scopes
  -> inspect system events
```

Minimum admin screens:

- Tenant settings.
- Users and memberships.
- Programs and cohorts.
- Syllabus bindings.
- Domain graph editor.
- LLM configuration matrix.
- Event outbox monitor.

Design gates:

- Tenant scope is always visible in admin areas.
- LLM configuration makes the hierarchy explicit: tenant, program, cohort,
  learner.
- Domain graph editing prevents or clearly reports cycles and invalid edges.
- Dangerous configuration changes have review states before save.

### 6. Define Screen Contracts Before UI Polish

For each screen, write a contract before high-fidelity design.

Template:

```txt
Screen:
Primary user:
Primary job:
Runtime/API source:
Primary action:
Secondary actions:
Empty state:
Loading state:
Error state:
Permissions:
Event or audit evidence:
Acceptance criteria:
```

Example:

```txt
Screen: Learner Current Activity
Primary user: Learner
Primary job: Complete the next runtime-selected activity
Runtime/API source:
  POST /v1/tenants/{tenant_id}/learners/{learner_id}/activities/next
  POST /v1/tenants/{tenant_id}/tutor-instructions/{instruction_id}/generate
  POST /v1/tenants/{tenant_id}/interactions
Primary action: Submit evidence
Empty state: No domain assigned or no concepts in graph
Error state: Runtime cannot plan because graph is invalid
Permissions: Learner can only access own learner routes
Event evidence: ActivityPlanned, TutorInstructionCreated, InteractionRecorded
Acceptance criteria: state delta is visible after submission
```

### 7. Build The Information Architecture

Do not start with a marketing-style landing page. The first logged-in screen
should be the user's operating surface.

Suggested navigation:

```txt
Learner
  Now
  Reviews
  Progress
  History

Trainer
  Cohorts
  Alerts
  Misconceptions
  Learners
  Domains

Admin
  Tenants
  Identity
  Programs
  Syllabi
  LLM
  Events
```

Each area should have one primary command. For example, the learner "Now" page
asks LORE for the next activity; the trainer "Alerts" page triages; the admin
"Domains" page publishes a concept graph.

### 8. Prototype With Runtime Scenarios

Prototype against scenarios, not static personas.

Required scenarios:

- New learner with no evidence enters diagnostic phase.
- Learner fails three times and enters overload recovery.
- Learner misses a review and generates a `ReviewDue` alert.
- Learner shows an active misconception and gets a repair activity.
- Learner reaches stable mastery and receives assessment or transfer work.
- Trainer triages a `LearnerAtRisk` alert.
- Admin configures a learner-specific LLM override.

Output:

- Clickable prototype or low-fidelity wireframes.
- Scenario checklist.
- API fixture data.
- Risks found before implementation.

### 9. Visual System Direction

Use a restrained operational product style.

Recommended traits:

- Compact panels, tables, timelines, and inspectors.
- Clear state colors for risk, review due, mastered, misconception, overload.
- Icons for repeated tools and actions.
- No decorative dashboards that obscure the next action.
- No course-card grid as the primary learner experience.
- No chat-first interface as the default mental model.

Core components:

- Runtime decision card.
- Evidence form.
- State delta summary.
- Review queue item.
- Alert row.
- Misconception item.
- Snapshot timeline.
- Concept graph node.
- LLM scope selector.

### 10. Implementation Readiness Gate

A front feature is ready to build only when these are true:

- The target user and job are explicit.
- The runtime/API source is known.
- Required states are defined: loading, empty, success, error, unauthorized.
- Permission behavior is defined.
- Events or snapshots that prove the workflow are identified.
- The design does not duplicate backend pedagogy rules.
- The design can still work when LLM generation falls back to instruction-only.

## First Front MVP Sequence

Build in this order:

1. Authenticated shell with tenant context.
2. Learner "Now" activity loop.
3. Interaction submission and state delta summary.
4. Trainer cohort health and alert inbox.
5. Learner snapshots/history inspector.
6. Domain graph read view, then editor.
7. Admin LLM configuration hierarchy.
8. Event outbox monitor.

This sequence validates the new LMS mental model early: the product succeeds if
users trust the runtime decisions and can act on them quickly.
