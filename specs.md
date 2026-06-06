# LORE V1 Specifications

## Scope

LORE V1 is a headless, multi-tenant Learning Orchestration Runtime Engine.
It is implemented in Go and deployed as a modular monolith. It exposes APIs
and events, not a user interface. It does not store SCORM packages, video,
audio, PDF libraries, or other media assets.

The runtime is the source of truth. It decides what to learn, when to review,
when to assess, and when a concept can be considered mastered. The LLM is an
interchangeable content generator. It can generate explanations, exercises,
feedback drafts, and structured observations, but it never owns durable
pedagogical state.

## Non-Negotiable Invariants

- Product code is Go.
- The LMS is headless: REST first, with gRPC and events as future-compatible
  interfaces.
- Every business entity belongs to a tenant.
- Every business table has `tenant_id UUID NOT NULL`.
- PostgreSQL Row Level Security is mandatory for the durable V1 store.
- No repository method may read or mutate a business aggregate by ID without a
  tenant scope.
- The concept graph is a DAG; cycles and cross-domain edges are rejected.
- Runtime decisions are deterministic for the same tenant, learner, graph,
  state snapshot, policy, and injected clock.
- The LLM receives `TutorInstruction`; it cannot directly write mastery,
  review dates, phase, selected concept, or completion events.
- Every interaction writes a trace, state delta, review delta, decision audit,
  and event in one transaction in the durable implementation.
- Scores and probabilities are bounded in `[0,1]`; `NaN` and `Inf` are invalid.
- Local deployment must work without cloud credentials.

## Bounded Contexts

| Context | V1 Responsibility | Out of Scope |
|---|---|---|
| Tenant | tenants, sub-tenants, status, isolation | billing automation |
| Identity | users, memberships, roles, JWT/OIDC boundary | advanced IAM |
| Learning | programs, cohorts, enrollments, syllabi, domains, concept DAG | SCORM/media libraries |
| Runtime | learner state, review cards, planning, interactions, evaluations, snapshots | LLM decisions |
| LLM Gateway | provider/model config, Ollama default, adapter interface | fine-tuning |
| Analytics | learner state, cohort health, alerts, misconceptions | BI warehouse |
| Notification | event-backed alert dispatch | chat UI |

## V1 REST API

Tenant-scoped business routes use:

```http
/v1/tenants/{tenant_id}/...
```

Platform:

```http
GET  /health
POST /v1/tenants
GET  /v1/tenants/{tenant_id}
POST /v1/users
```

Identity:

```http
POST /v1/tenants/{tenant_id}/memberships
GET  /v1/tenants/{tenant_id}/memberships
```

Learning:

```http
POST /v1/tenants/{tenant_id}/programs
POST /v1/tenants/{tenant_id}/cohorts
POST /v1/tenants/{tenant_id}/cohorts/{cohort_id}/enrollments
POST /v1/tenants/{tenant_id}/syllabi
POST /v1/tenants/{tenant_id}/syllabi/{syllabus_id}/bindings
POST /v1/tenants/{tenant_id}/domains
PUT  /v1/tenants/{tenant_id}/domains/{domain_id}/graph
GET  /v1/tenants/{tenant_id}/domains/{domain_id}
```

Runtime:

```http
POST /v1/tenants/{tenant_id}/learners/{learner_id}/activities/next
POST /v1/tenants/{tenant_id}/activities/{activity_id}/start
POST /v1/tenants/{tenant_id}/interactions
GET  /v1/tenants/{tenant_id}/learners/{learner_id}/state
GET  /v1/tenants/{tenant_id}/learners/{learner_id}/snapshots
```

LLM Gateway:

```http
GET  /v1/tenants/{tenant_id}/llm-configurations
PUT  /v1/tenants/{tenant_id}/llm-configurations
POST /v1/tenants/{tenant_id}/tutor-instructions/{instruction_id}/generate
GET  /v1/tenants/{tenant_id}/generated-content
GET  /v1/tenants/{tenant_id}/generated-content/{content_id}
```

Analytics and alerts:

```http
GET   /v1/tenants/{tenant_id}/analytics/cohorts/{cohort_id}
GET   /v1/tenants/{tenant_id}/alerts
PATCH /v1/tenants/{tenant_id}/alerts/{alert_id}
```

## PostgreSQL Durable Store

Primary V1 tables:

```txt
tenants
users
memberships
programs
cohorts
cohort_enrollments
syllabi
syllabus_bindings
domains
concepts
concept_dependencies
learner_states
review_cards
activities
tutor_instructions
generated_contents
interactions
evaluations
misconceptions
pedagogical_snapshots
alerts
event_outbox
```

Durable constraints:

- `UNIQUE (tenant_id, id)` on tenant-scoped aggregates.
- Composite foreign keys include `tenant_id`.
- `tenant_id` is UUID. Other aggregate identifiers are stable text IDs so
  headless clients can bring their own learner, concept, and external IDs while
  still being isolated by tenant.
- RLS is enabled and forced on all tenant-scoped tables.
- Runtime writes use a single transaction for interaction, evaluation,
  learner state, review card, snapshot, outbox event, and idempotency record.
- `POST /interactions` and `POST /assessments/{activity_id}/submit` accept
  `Idempotency-Key`; retries with the same key replay the original successful
  response without reapplying pedagogy state changes.

## Runtime Pipeline

The runtime pipeline is inspired by the local Tutor MCP runtime under
`/home/ubuntu/mcp`: BKT mastery, FSRS review scheduling, phase control, gates,
concept selection, action selection, alerts, and replayable decision snapshots.

V1 pipeline:

1. Load tenant, learner, domain, graph version, learner model, recent traces.
2. Validate the domain graph DAG and prerequisite references.
3. Update or derive mastery, retention, ability, confidence, and evidence.
4. Detect alerts: review due, low retention, plateau, ZPD drift, overload,
   mastery ready, learner at risk.
5. Evaluate phase: `DIAGNOSTIC`, `INSTRUCTION`, or `MAINTENANCE`.
6. Apply gate: overload escape, prerequisite filter, anti-repeat window,
   misconception lock, critical review bypass.
7. Select concept:
   - diagnostic: highest uncertainty or missing evidence;
   - instruction: prerequisite-satisfied fringe maximizing `1 - mastery`;
   - maintenance: mastered concept with lowest retention or earliest due date.
8. Select activity:
   - misconception before recall;
   - recall/review before new content when due;
   - explanation for very low mastery;
   - guided/free practice in the learning band;
   - assessment, Feynman, or transfer for stable high mastery.
9. Build `TutorInstruction`.
10. Optionally generate content through `LLMGenerator`.
11. Persist activity, interaction, learner state, review schedule, snapshot, and
    event.

## Runtime Interfaces

```go
type RuntimeEngine interface {
    PlanNext(ctx context.Context, in PlanNextInput) (RuntimeDecision, error)
    RecordInteraction(ctx context.Context, in InteractionCommand) (StateDelta, error)
    GetLearnerModel(ctx context.Context, in LearnerQuery) (LearnerModel, error)
}

type DeterministicPlanner interface {
    EvaluatePhase(snapshot PhaseSnapshot) PhaseDecision
    ApplyGate(input GateInput) GateResult
    SelectConcept(input SelectionInput) ConceptSelection
    SelectActivity(input ActivityInput) ActivityDecision
    BuildInstruction(input InstructionInput) TutorInstruction
}

type LLMGenerator interface {
    Generate(ctx context.Context, instruction TutorInstruction) (GeneratedContent, error)
}
```

## LLM Gateway

Default local policy:

```yaml
llm:
  default_provider: ollama
  default_model: gemma4
```

Required providers:

```txt
Ollama
OpenAI
Anthropic
Gemini
Mistral
Custom
```

V1 must also support an instruction-only fallback so the LMS remains useful
when a local model is not running. Generated content must reference a runtime
created `TutorInstruction`.

Provider calls are side-effect-free from the runtime perspective. Failed hosted
provider calls fall back to `instruction_only` and never block planning,
interaction recording, reviews, snapshots, or events.

## Events

Events are written to PostgreSQL outbox and published to NATS JetStream after
commit.

Envelope:

```json
{
  "tenant_id": "uuid",
  "id": "uuid",
  "schema_version": 1,
  "actor_user_id": "string",
  "correlation_id": "string",
  "causation_id": "string",
  "event_type": "ActivityCompleted",
  "aggregate_type": "activity",
  "aggregate_id": "string",
  "occurred_at": "timestamp",
  "payload": {}
}
```

V1 events:

```txt
TenantCreated
UserCreated
MembershipChanged
ProgramCreated
CohortCreated
LearnerEnrolled
SyllabusCreated
SyllabusBound
DomainCreated
ConceptGraphPublished
ActivityPlanned
ActivityStarted
ActivityCompleted
InteractionRecorded
EvaluationRecorded
LearnerStateUpdated
ReviewScheduled
ReviewDue
ReviewCompleted
ConceptMastered
MisconceptionDetected
MisconceptionResolved
AlertRaised
AlertResolved
TutorInstructionCreated
GeneratedContentCreated
```

## Acceptance Criteria

- `go test ./...` passes.
- The REST server starts with no external dependency.
- Docker Compose declares `lore`, `postgres`, `redis`, `nats`, and `ollama`.
- A tenant can create users, memberships, domains, concepts, dependencies, and
  cohorts through the headless API.
- Cross-tenant reads and writes are rejected.
- JWT roles are enforced: tenant admins and trainers manage learning resources;
  learner tokens are limited to their own planning, evidence, state, reviews,
  and snapshots.
- The graph validator rejects cycles, unknown concepts, and cross-domain edges.
- `PlanNext` is deterministic across repeated calls against the same snapshot.
- `PlanNext` starts in `DIAGNOSTIC` for concepts without evidence and applies an
  anti-repeat penalty to recently practiced concepts during instruction.
- `RecordInteraction` updates mastery and review scheduling without LLM input.
- Learner state, alerts, snapshots, generated content, and events are readable
  through tenant-scoped routes.
- Alerts are persisted with tenant-scoped deduplication keys. New alerts emit
  `AlertRaised`; `PATCH /alerts/{alert_id}` persists `ACKNOWLEDGED` or
  `RESOLVED`, and resolved alerts emit `AlertResolved`.
- A score outside `[0,1]` is rejected.
- Generated content is linked to an existing tutor instruction.

## MVP Implementation Order

1. Go module, config, HTTP server, healthcheck.
2. Shared models, IDs, JSON helpers.
3. In-memory store implementing the repository contract.
4. Learning graph creation and DAG validation.
5. Runtime planner, BKT update, FSRS-like review scheduling, snapshots.
6. REST API for tenant, identity, learning, runtime, analytics, alerts.
7. PostgreSQL migration contract with RLS.
8. Docker Compose local deployment.
9. Tests for graph validity, runtime determinism, interactions, and tenant
   isolation.
