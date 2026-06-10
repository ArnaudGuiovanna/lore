package httpapi_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"lore/internal/auth"
	"lore/internal/cache"
	"lore/internal/core"
	"lore/internal/httpapi"
	"lore/internal/llm"
	"lore/internal/runtime"
	"lore/internal/store"
)

func TestRESTRejectsCrossTenantDomainAccess(t *testing.T) {
	server := newTestServer()

	tenantA := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	tenantB := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "B", "slug": "b"}, http.StatusCreated)
	graph := postJSON[core.DomainGraph](t, server, "/v1/tenants/"+tenantA.ID+"/domains", map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{
			{"id": "c1", "name": "HTTP", "difficulty": 0.4},
		},
	}, http.StatusCreated)

	req := httptest.NewRequest(http.MethodGet, "/v1/tenants/"+tenantB.ID+"/domains/"+graph.Domain.ID, nil)
	resp := httptest.NewRecorder()
	server.ServeHTTP(resp, req)
	if resp.Code != http.StatusNotFound {
		t.Fatalf("cross-tenant domain read status=%d body=%s", resp.Code, resp.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/tenants/"+tenantB.ID+"/learners/l1/activities/next", jsonBody(map[string]any{"domain_id": graph.Domain.ID}))
	resp = httptest.NewRecorder()
	server.ServeHTTP(resp, req)
	if resp.Code != http.StatusNotFound {
		t.Fatalf("cross-tenant runtime read status=%d body=%s", resp.Code, resp.Body.String())
	}
}

func TestRESTRuntimeAndGenerationFlow(t *testing.T) {
	server := newTestServer()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	graph := postJSON[core.DomainGraph](t, server, "/v1/tenants/"+tenant.ID+"/domains", map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{
			{"id": "c1", "name": "HTTP", "difficulty": 0.4},
		},
	}, http.StatusCreated)

	decision := postJSON[core.RuntimeDecision](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/activities/next", map[string]any{
		"domain_id": graph.Domain.ID,
	}, http.StatusCreated)
	if decision.Activity.ActivityType != core.ActivityAssessment {
		t.Fatalf("activity type=%s", decision.Activity.ActivityType)
	}
	content := postJSON[core.GeneratedContent](t, server, "/v1/tenants/"+tenant.ID+"/tutor-instructions/"+decision.TutorInstruction.ID+"/generate", map[string]any{}, http.StatusCreated)
	if content.InstructionID != decision.TutorInstruction.ID {
		t.Fatalf("generated content not linked to instruction")
	}
	started := postJSON[core.Activity](t, server, "/v1/tenants/"+tenant.ID+"/activities/"+decision.Activity.ID+"/start", map[string]any{}, http.StatusOK)
	if started.Status != core.ActivityStarted {
		t.Fatalf("activity was not started: %+v", started)
	}

	// B-07: pause then resume — pause opens paused_at, resume closes it.
	paused := postJSON[core.Activity](t, server, "/v1/tenants/"+tenant.ID+"/activities/"+decision.Activity.ID+"/pause", map[string]any{}, http.StatusOK)
	if paused.PausedAt == nil {
		t.Fatalf("pause did not set paused_at: %+v", paused)
	}
	resumed := postJSON[core.Activity](t, server, "/v1/tenants/"+tenant.ID+"/activities/"+decision.Activity.ID+"/resume", map[string]any{}, http.StatusOK)
	if resumed.PausedAt != nil {
		t.Fatalf("resume left paused_at open: %+v", resumed)
	}

	delta := postJSON[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/assessments/"+decision.Activity.ID+"/submit", correctedAssessmentBody("l1", decision.Activity.ConceptID), http.StatusCreated)
	if delta.After.Mastery <= delta.Before.Mastery {
		t.Fatalf("mastery did not increase")
	}
	events := getJSON[[]core.Event](t, server, "/v1/tenants/"+tenant.ID+"/events/outbox?published=false", http.StatusOK)
	if len(events) < 5 {
		t.Fatalf("expected planned/generated/interaction events, got %d", len(events))
	}
	eventTypes := map[string]core.Event{}
	for _, event := range events {
		if event.SchemaVersion != 1 {
			t.Fatalf("event missing schema version: %+v", event)
		}
		if event.CorrelationID == "" {
			t.Fatalf("event missing correlation id: %+v", event)
		}
		eventTypes[event.EventType] = event
	}
	for _, eventType := range []string{"DomainCreated", "ConceptGraphPublished", "ActivityPlanned", "TutorInstructionCreated", "ActivityStarted", "GeneratedContentCreated", "ActivityCompleted", "InteractionRecorded"} {
		if _, ok := eventTypes[eventType]; !ok {
			t.Fatalf("missing event type %s in %+v", eventType, eventTypes)
		}
	}
	published := patchJSON[core.Event](t, server, "/v1/tenants/"+tenant.ID+"/events/"+events[0].ID+"/published", map[string]any{}, http.StatusOK)
	if published.PublishedAt == nil {
		t.Fatalf("event was not marked published")
	}
	if published.SchemaVersion != 1 || published.CorrelationID == "" {
		t.Fatalf("published event lost envelope: %+v", published)
	}
}

func TestRESTDueReviewsAfterFailedInteraction(t *testing.T) {
	server := newTestServer()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	graph := postJSON[core.DomainGraph](t, server, "/v1/tenants/"+tenant.ID+"/domains", map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{
			{"id": "c1", "name": "HTTP", "difficulty": 0.4},
		},
	}, http.StatusCreated)
	decision := postJSON[core.RuntimeDecision](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/activities/next", map[string]any{
		"domain_id": graph.Domain.ID,
	}, http.StatusCreated)
	_ = postJSON[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/assessments/"+decision.Activity.ID+"/submit", correctedAssessmentBody("l1", "not_sure"), http.StatusCreated)

	reviews := getJSON[[]core.ReviewCard](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/reviews/due", http.StatusOK)
	if len(reviews) != 1 {
		t.Fatalf("expected one due review, got %d", len(reviews))
	}
	if reviews[0].ConceptID != "c1" || reviews[0].State != core.ReviewRelearning {
		t.Fatalf("unexpected review card: %+v", reviews[0])
	}
}

func TestRESTAssessmentPlanAndSubmit(t *testing.T) {
	server := newTestServer()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	graph := postJSON[core.DomainGraph](t, server, "/v1/tenants/"+tenant.ID+"/domains", map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{
			{"id": "c1", "name": "HTTP", "difficulty": 0.4},
		},
	}, http.StatusCreated)

	decision := postJSON[core.RuntimeDecision](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/assessments/plan", map[string]any{
		"domain_id": graph.Domain.ID,
	}, http.StatusCreated)
	if decision.Activity.ActivityType != core.ActivityAssessment {
		t.Fatalf("expected assessment activity, got %s", decision.Activity.ActivityType)
	}
	delta := postJSON[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/assessments/"+decision.Activity.ID+"/submit", map[string]any{
		"learner_id": "l1",
		"success":    false,
		"score":      0.10,
		"confidence": 0.70,
		"answers": []map[string]any{
			{"item_id": "concept-check", "choice_id": decision.Activity.ConceptID},
		},
	}, http.StatusCreated)
	if delta.Evaluation.Rubric["activity_type"] != string(core.ActivityAssessment) {
		t.Fatalf("assessment rubric did not preserve runtime activity type: %+v", delta.Evaluation.Rubric)
	}
	if delta.After.Mastery <= delta.Before.Mastery {
		t.Fatalf("assessment evidence did not update mastery")
	}
	if delta.Interaction.Score != 1 || !delta.Interaction.Success {
		t.Fatalf("assessment score should come from corrected answers, got interaction=%+v", delta.Interaction)
	}
	if delta.Evaluation.Rubric["score_source"] != "runtime_correction" || delta.Evaluation.Rubric["self_reported_success"] != false {
		t.Fatalf("assessment rubric did not distinguish corrected evidence from self-report: %+v", delta.Evaluation.Rubric)
	}
	if countEventType(delta.Events, "AssessmentCompleted") != 1 {
		t.Fatalf("expected AssessmentCompleted event, got %+v", delta.Events)
	}
}

func TestAssessmentSubmitIgnoresSelfReportedMasteryEvidence(t *testing.T) {
	server := newTestServer()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	graph := postJSON[core.DomainGraph](t, server, "/v1/tenants/"+tenant.ID+"/domains", map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{{"id": "c1", "name": "HTTP", "difficulty": 0.4}},
	}, http.StatusCreated)

	decision := postJSON[core.RuntimeDecision](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/assessments/plan", map[string]any{
		"domain_id": graph.Domain.ID,
	}, http.StatusCreated)
	delta := postJSON[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/assessments/"+decision.Activity.ID+"/submit", map[string]any{
		"learner_id": "l1",
		"success":    true,
		"score":      1,
		"confidence": 1,
		"answers": []map[string]any{
			{"item_id": "concept-check", "choice_id": "not_sure"},
		},
	}, http.StatusCreated)

	if delta.Interaction.Score != 0 || delta.Interaction.Success {
		t.Fatalf("self-reported success/score overrode correction: %+v", delta.Interaction)
	}
	if delta.Evaluation.Score != 0 {
		t.Fatalf("evaluation score should be corrected score, got %+v", delta.Evaluation)
	}
	if delta.Evaluation.Rubric["score_source"] != "runtime_correction" {
		t.Fatalf("missing corrected score source: %+v", delta.Evaluation.Rubric)
	}
	if delta.After.Mastery >= runtime.MasteryThreshold {
		t.Fatalf("wrong corrected answer should not validate mastery: before=%f after=%f", delta.Before.Mastery, delta.After.Mastery)
	}
}

func TestRawInteractionRejectsAssessmentActivity(t *testing.T) {
	server := newTestServer()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	graph := postJSON[core.DomainGraph](t, server, "/v1/tenants/"+tenant.ID+"/domains", map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{{"id": "c1", "name": "HTTP", "difficulty": 0.4}},
	}, http.StatusCreated)
	decision := postJSON[core.RuntimeDecision](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/assessments/plan", map[string]any{
		"domain_id": graph.Domain.ID,
	}, http.StatusCreated)

	expectJSONStatus(t, server, http.MethodPost, "/v1/tenants/"+tenant.ID+"/interactions", map[string]any{
		"learner_id":  "l1",
		"activity_id": decision.Activity.ID,
		"success":     true,
		"score":       1,
	}, nil, http.StatusBadRequest)
}

func TestTenantLLMConfigurationControlsGenerationAndContentReads(t *testing.T) {
	server := newTestServer()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	graph := postJSON[core.DomainGraph](t, server, "/v1/tenants/"+tenant.ID+"/domains", map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{{"id": "c1", "name": "HTTP", "difficulty": 0.4}},
	}, http.StatusCreated)
	decision := postJSON[core.RuntimeDecision](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/activities/next", map[string]any{
		"domain_id": graph.Domain.ID,
	}, http.StatusCreated)

	config := putJSON[core.LLMConfiguration](t, server, "/v1/tenants/"+tenant.ID+"/llm-configurations", map[string]any{
		"provider": "instruction_only",
		"model":    "tenant-runtime",
		"api_key":  "secret",
	}, http.StatusOK)
	if config.Model != "tenant-runtime" || config.APIKey != "" || !config.APIKeyConfigured {
		t.Fatalf("unexpected public llm config: %+v", config)
	}
	config = getJSON[core.LLMConfiguration](t, server, "/v1/tenants/"+tenant.ID+"/llm-configurations", http.StatusOK)
	if config.Model != "tenant-runtime" || config.APIKey != "" || !config.APIKeyConfigured {
		t.Fatalf("unexpected fetched llm config: %+v", config)
	}

	content := postJSON[core.GeneratedContent](t, server, "/v1/tenants/"+tenant.ID+"/tutor-instructions/"+decision.TutorInstruction.ID+"/generate", map[string]any{}, http.StatusCreated)
	if content.Model != "tenant-runtime" {
		t.Fatalf("tenant llm config did not control generated model: %+v", content)
	}
	listed := getJSON[[]core.GeneratedContent](t, server, "/v1/tenants/"+tenant.ID+"/generated-content?instruction_id="+decision.TutorInstruction.ID, http.StatusOK)
	if len(listed) != 1 || listed[0].ID != content.ID {
		t.Fatalf("generated content list mismatch: %+v", listed)
	}
	fetched := getJSON[core.GeneratedContent](t, server, "/v1/tenants/"+tenant.ID+"/generated-content/"+content.ID, http.StatusOK)
	if fetched.ID != content.ID || fetched.Content == "" {
		t.Fatalf("generated content fetch mismatch: %+v", fetched)
	}
}

func TestScopedLLMConfigurationOverridesTenantForGeneration(t *testing.T) {
	server := newTestServer()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	graph := postJSON[core.DomainGraph](t, server, "/v1/tenants/"+tenant.ID+"/domains", map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{{"id": "c1", "name": "HTTP", "difficulty": 0.4}},
	}, http.StatusCreated)
	decision := postJSON[core.RuntimeDecision](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/activities/next", map[string]any{
		"domain_id": graph.Domain.ID,
	}, http.StatusCreated)

	tenantConfig := putJSON[core.LLMConfiguration](t, server, "/v1/tenants/"+tenant.ID+"/llm-configurations", map[string]any{
		"provider": "instruction_only",
		"model":    "tenant-runtime",
	}, http.StatusOK)
	if tenantConfig.ScopeType != "tenant" || tenantConfig.ScopeID != "" {
		t.Fatalf("unexpected tenant config scope: %+v", tenantConfig)
	}
	learnerConfig := putJSON[core.LLMConfiguration](t, server, "/v1/tenants/"+tenant.ID+"/llm-configurations?scope_type=learner&scope_id=l1", map[string]any{
		"provider": "instruction_only",
		"model":    "learner-runtime",
	}, http.StatusOK)
	if learnerConfig.ScopeType != "learner" || learnerConfig.ScopeID != "l1" {
		t.Fatalf("unexpected learner config scope: %+v", learnerConfig)
	}
	fetched := getJSON[core.LLMConfiguration](t, server, "/v1/tenants/"+tenant.ID+"/llm-configurations?scope_type=learner&scope_id=l1", http.StatusOK)
	if fetched.Model != "learner-runtime" || fetched.ScopeType != "learner" || fetched.ScopeID != "l1" {
		t.Fatalf("scoped llm config fetch mismatch: %+v", fetched)
	}

	content := postJSON[core.GeneratedContent](t, server, "/v1/tenants/"+tenant.ID+"/tutor-instructions/"+decision.TutorInstruction.ID+"/generate", map[string]any{}, http.StatusCreated)
	if content.Model != "learner-runtime" {
		t.Fatalf("learner-scoped llm config did not override tenant config: %+v", content)
	}
	expectJSONStatus(t, server, http.MethodPut, "/v1/tenants/"+tenant.ID+"/llm-configurations?scope_type=program", map[string]any{
		"provider": "instruction_only",
		"model":    "program-runtime",
	}, nil, http.StatusBadRequest)
}

func TestInteractionIdempotencyKeyReplaysWithoutReapplying(t *testing.T) {
	server := newTestServer()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	graph := postJSON[core.DomainGraph](t, server, "/v1/tenants/"+tenant.ID+"/domains", map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{{"id": "c1", "name": "HTTP", "difficulty": 0.4}},
	}, http.StatusCreated)
	decision := postJSON[core.RuntimeDecision](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/activities/next", map[string]any{
		"domain_id": graph.Domain.ID,
	}, http.StatusCreated)
	_ = postJSON[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/assessments/"+decision.Activity.ID+"/submit", correctedAssessmentBody("l1", decision.Activity.ConceptID), http.StatusCreated)
	practice := postJSON[core.RuntimeDecision](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/activities/next", map[string]any{
		"domain_id": graph.Domain.ID,
	}, http.StatusCreated)
	if practice.Activity.ActivityType == core.ActivityAssessment {
		t.Fatalf("expected a non-assessment activity for raw interaction idempotency, got %s", practice.Activity.ActivityType)
	}
	body := map[string]any{
		"learner_id":  "l1",
		"activity_id": practice.Activity.ID,
		"success":     true,
		"score":       0.86,
	}

	first, firstResp := postJSONWithHeaders[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/interactions", body, map[string]string{
		"Idempotency-Key": "interaction-retry-1",
	}, http.StatusCreated)
	if firstResp.Header().Get("X-LORE-Idempotent-Replay") != "" {
		t.Fatalf("first request should not be marked as replay")
	}
	replay, replayResp := postJSONWithHeaders[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/interactions", body, map[string]string{
		"Idempotency-Key": "interaction-retry-1",
	}, http.StatusCreated)
	if replayResp.Header().Get("X-LORE-Idempotent-Replay") != "true" {
		t.Fatalf("expected idempotent replay header")
	}
	if replay.Interaction.ID != first.Interaction.ID || replay.Evaluation.ID != first.Evaluation.ID {
		t.Fatalf("replay returned a different persisted delta")
	}
	states := getJSON[[]core.LearnerState](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/state", http.StatusOK)
	if len(states) != 1 || states[0].Reps != 2 {
		t.Fatalf("idempotent replay reapplied learner state: %+v", states)
	}

	second, _ := postJSONWithHeaders[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/interactions", body, map[string]string{
		"Idempotency-Key": "interaction-retry-2",
	}, http.StatusCreated)
	if second.Interaction.ID == first.Interaction.ID {
		t.Fatalf("different idempotency key should create a new interaction")
	}
	states = getJSON[[]core.LearnerState](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/state", http.StatusOK)
	if len(states) != 1 || states[0].Reps != 3 {
		t.Fatalf("different idempotency key did not apply new evidence: %+v", states)
	}
}

func TestAssessmentSubmitIdempotencyKeyReplaysWithoutReapplying(t *testing.T) {
	server := newTestServer()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	graph := postJSON[core.DomainGraph](t, server, "/v1/tenants/"+tenant.ID+"/domains", map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{{"id": "c1", "name": "HTTP", "difficulty": 0.4}},
	}, http.StatusCreated)
	decision := postJSON[core.RuntimeDecision](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/assessments/plan", map[string]any{
		"domain_id": graph.Domain.ID,
	}, http.StatusCreated)
	body := map[string]any{
		"learner_id": "l1",
		"answers": []map[string]any{
			{"item_id": "concept-check", "choice_id": decision.Activity.ConceptID},
		},
	}
	path := "/v1/tenants/" + tenant.ID + "/assessments/" + decision.Activity.ID + "/submit"

	first, _ := postJSONWithHeaders[core.StateDelta](t, server, path, body, map[string]string{
		"Idempotency-Key": "assessment-submit-1",
	}, http.StatusCreated)
	replay, replayResp := postJSONWithHeaders[core.StateDelta](t, server, path, body, map[string]string{
		"Idempotency-Key": "assessment-submit-1",
	}, http.StatusCreated)
	if replayResp.Header().Get("X-LORE-Idempotent-Replay") != "true" {
		t.Fatalf("expected assessment replay header")
	}
	if replay.Interaction.ID != first.Interaction.ID {
		t.Fatalf("assessment replay returned a different interaction")
	}
	states := getJSON[[]core.LearnerState](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/state", http.StatusOK)
	if len(states) != 1 || states[0].Reps != 1 {
		t.Fatalf("assessment replay reapplied learner state: %+v", states)
	}
}

func TestAlertsAreDurablePatchableAndEmitEvents(t *testing.T) {
	server := newTestServer()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	graph := postJSON[core.DomainGraph](t, server, "/v1/tenants/"+tenant.ID+"/domains", map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{{"id": "c1", "name": "HTTP", "difficulty": 0.4}},
	}, http.StatusCreated)
	decision := postJSON[core.RuntimeDecision](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/activities/next", map[string]any{
		"domain_id": graph.Domain.ID,
	}, http.StatusCreated)
	_ = postJSON[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/assessments/"+decision.Activity.ID+"/submit", correctedAssessmentBody("l1", "not_sure"), http.StatusCreated)
	review := postJSON[core.RuntimeDecision](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/activities/next", map[string]any{
		"domain_id": graph.Domain.ID,
	}, http.StatusCreated)
	for range 3 {
		_ = postJSON[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/interactions", map[string]any{
			"learner_id":  "l1",
			"activity_id": review.Activity.ID,
			"success":     false,
			"score":       0.10,
		}, http.StatusCreated)
	}

	alerts := getJSON[[]core.Alert](t, server, "/v1/tenants/"+tenant.ID+"/alerts", http.StatusOK)
	reviewDue := findAlert(t, alerts, "ReviewDue")
	if reviewDue.ConceptID != "c1" || reviewDue.Status != "OPEN" {
		t.Fatalf("unexpected ReviewDue alert: %+v", reviewDue)
	}
	risk := findAlert(t, alerts, "LearnerAtRisk")
	if risk.Status != "OPEN" || risk.ID == "" || risk.RecommendedAction == "" {
		t.Fatalf("unexpected durable alert: %+v", risk)
	}
	overload := findAlert(t, alerts, "Overload")
	if overload.Status != "OPEN" || overload.ID == "" || overload.Severity != "critical" {
		t.Fatalf("unexpected overload alert: %+v", overload)
	}
	alerts = getJSON[[]core.Alert](t, server, "/v1/tenants/"+tenant.ID+"/alerts", http.StatusOK)
	replayedRisk := findAlert(t, alerts, "LearnerAtRisk")
	if replayedRisk.ID != risk.ID {
		t.Fatalf("durable alert was not deduplicated: first=%s second=%s", risk.ID, replayedRisk.ID)
	}
	events := getJSON[[]core.Event](t, server, "/v1/tenants/"+tenant.ID+"/events/outbox?published=false", http.StatusOK)
	if countEvents(events, "ReviewDue", "ReviewDue") != 1 {
		t.Fatalf("expected one ReviewDue event, got events=%+v", events)
	}
	if countEvents(events, "AlertRaised", "ReviewDue") != 1 {
		t.Fatalf("expected one AlertRaised event for ReviewDue, got events=%+v", events)
	}
	if countEvents(events, "AlertRaised", "LearnerAtRisk") != 1 {
		t.Fatalf("expected one AlertRaised event for LearnerAtRisk, got events=%+v", events)
	}
	if countEventType(events, "LearnerAtRisk") != 1 {
		t.Fatalf("expected one LearnerAtRisk domain event, got events=%+v", events)
	}
	if countEvents(events, "AlertRaised", "Overload") != 1 {
		t.Fatalf("expected one AlertRaised event for Overload, got events=%+v", events)
	}

	ack := patchJSON[core.Alert](t, server, "/v1/tenants/"+tenant.ID+"/alerts/"+risk.ID, map[string]any{"status": "ACKNOWLEDGED"}, http.StatusOK)
	if ack.Status != "ACKNOWLEDGED" {
		t.Fatalf("alert was not acknowledged: %+v", ack)
	}
	alerts = getJSON[[]core.Alert](t, server, "/v1/tenants/"+tenant.ID+"/alerts", http.StatusOK)
	ackRisk := findAlert(t, alerts, "LearnerAtRisk")
	if ackRisk.ID != risk.ID || ackRisk.Status != "ACKNOWLEDGED" {
		t.Fatalf("acknowledged alert state did not persist: %+v", ackRisk)
	}
	resolved := patchJSON[core.Alert](t, server, "/v1/tenants/"+tenant.ID+"/alerts/"+risk.ID, map[string]any{"status": "RESOLVED"}, http.StatusOK)
	if resolved.Status != "RESOLVED" {
		t.Fatalf("alert was not resolved: %+v", resolved)
	}
	alerts = getJSON[[]core.Alert](t, server, "/v1/tenants/"+tenant.ID+"/alerts", http.StatusOK)
	for _, alert := range alerts {
		if alert.ID == risk.ID {
			t.Fatalf("resolved alert still listed: %+v", alerts)
		}
	}
	events = getJSON[[]core.Event](t, server, "/v1/tenants/"+tenant.ID+"/events/outbox?published=false", http.StatusOK)
	if countEvents(events, "AlertResolved", "LearnerAtRisk") != 1 {
		t.Fatalf("expected one AlertResolved event for LearnerAtRisk, got events=%+v", events)
	}
}

func TestCohortAnalyticsIncludesActiveMisconceptions(t *testing.T) {
	server := newTestServer()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	program := postJSON[core.Program](t, server, "/v1/tenants/"+tenant.ID+"/programs", map[string]any{"name": "Go Backend"}, http.StatusCreated)
	cohort := postJSON[core.Cohort](t, server, "/v1/tenants/"+tenant.ID+"/cohorts", map[string]any{
		"program_id": program.ID,
		"name":       "June",
	}, http.StatusCreated)
	_ = postJSON[core.CohortEnrollment](t, server, "/v1/tenants/"+tenant.ID+"/cohorts/"+cohort.ID+"/enrollments", map[string]any{
		"learner_id": "l1",
	}, http.StatusCreated)
	graph := postJSON[core.DomainGraph](t, server, "/v1/tenants/"+tenant.ID+"/domains", map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{{"id": "c1", "name": "HTTP", "difficulty": 0.4}},
	}, http.StatusCreated)
	decision := postJSON[core.RuntimeDecision](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/activities/next", map[string]any{
		"domain_id": graph.Domain.ID,
	}, http.StatusCreated)
	_ = postJSON[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/assessments/"+decision.Activity.ID+"/submit", correctedAssessmentBody("l1", "not_sure"), http.StatusCreated)
	review := postJSON[core.RuntimeDecision](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/activities/next", map[string]any{
		"domain_id": graph.Domain.ID,
	}, http.StatusCreated)
	_ = postJSON[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/interactions", map[string]any{
		"learner_id":  "l1",
		"activity_id": review.Activity.ID,
		"success":     false,
		"score":       0.10,
		"error_type":  "off_by_one",
	}, http.StatusCreated)

	analytics := getJSON[map[string]any](t, server, "/v1/tenants/"+tenant.ID+"/analytics/cohorts/"+cohort.ID, http.StatusOK)
	if got := analytics["active_misconceptions"]; got != float64(1) {
		t.Fatalf("expected one active misconception in analytics, got %+v", analytics)
	}
	if _, ok := analytics["training_hours"]; !ok {
		t.Fatalf("expected training time fields in analytics, got %+v", analytics)
	}
	req := httptest.NewRequest(http.MethodGet, "/v1/tenants/"+tenant.ID+"/analytics/cohorts/"+cohort.ID+"/training-time.csv", nil)
	resp := httptest.NewRecorder()
	server.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("training time csv status=%d body=%s", resp.Code, resp.Body.String())
	}
	if ct := resp.Header().Get("Content-Type"); !strings.Contains(ct, "text/csv") {
		t.Fatalf("expected text/csv content type, got %q", ct)
	}
	body := resp.Body.String()
	if !strings.Contains(body, "learner_id") || !strings.Contains(body, "l1") {
		t.Fatalf("training time csv missing header or learner row: %q", body)
	}
	events := getJSON[[]core.Event](t, server, "/v1/tenants/"+tenant.ID+"/events/outbox?published=false", http.StatusOK)
	if countEventType(events, "LearnerEnrolled") != 1 {
		t.Fatalf("expected LearnerEnrolled event, got events=%+v", events)
	}

	// B-12/B-22: per-learner progress export.
	req = httptest.NewRequest(http.MethodGet, "/v1/tenants/"+tenant.ID+"/analytics/cohorts/"+cohort.ID+"/progress.csv", nil)
	resp = httptest.NewRecorder()
	server.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("progress csv status=%d body=%s", resp.Code, resp.Body.String())
	}
	progress := resp.Body.String()
	if !strings.Contains(progress, "concepts_mastered") || !strings.Contains(progress, "l1") {
		t.Fatalf("progress csv missing header or learner row: %q", progress)
	}
}

func TestRESTListEndpointsAreTenantScoped(t *testing.T) {
	server := newTestServer()
	tenantA := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	tenantB := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "B", "slug": "b"}, http.StatusCreated)
	tenantC := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "C", "slug": "c"}, http.StatusCreated)

	assertGETBody(t, server, "/v1/tenants/"+tenantC.ID+"/memberships", nil, http.StatusOK, "[]")

	programA := postJSON[core.Program](t, server, "/v1/tenants/"+tenantA.ID+"/programs", map[string]any{"name": "Go Backend"}, http.StatusCreated)
	programB := postJSON[core.Program](t, server, "/v1/tenants/"+tenantB.ID+"/programs", map[string]any{"name": "Rust Backend"}, http.StatusCreated)
	cohortA := postJSON[core.Cohort](t, server, "/v1/tenants/"+tenantA.ID+"/cohorts", map[string]any{"program_id": programA.ID, "name": "June"}, http.StatusCreated)
	cohortB := postJSON[core.Cohort](t, server, "/v1/tenants/"+tenantB.ID+"/cohorts", map[string]any{"program_id": programB.ID, "name": "July"}, http.StatusCreated)
	syllabusA := postJSON[core.Syllabus](t, server, "/v1/tenants/"+tenantA.ID+"/syllabi", map[string]any{"title": "Go Syllabus"}, http.StatusCreated)
	_ = postJSON[core.Syllabus](t, server, "/v1/tenants/"+tenantB.ID+"/syllabi", map[string]any{"title": "Rust Syllabus"}, http.StatusCreated)
	graphA := postJSON[core.DomainGraph](t, server, "/v1/tenants/"+tenantA.ID+"/domains", map[string]any{
		"owner_id": "trainer-a",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{{"id": "go-c1", "name": "HTTP", "difficulty": 0.4}},
	}, http.StatusCreated)
	_ = postJSON[core.DomainGraph](t, server, "/v1/tenants/"+tenantB.ID+"/domains", map[string]any{
		"owner_id": "trainer-b",
		"name":     "Rust",
		"source":   "TRAINER",
		"concepts": []map[string]any{{"id": "rust-c1", "name": "Ownership", "difficulty": 0.5}},
	}, http.StatusCreated)
	learnerA := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "learner-a@example.test", "name": "Learner A"}, http.StatusCreated)
	trainerA := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "trainer-a@example.test", "name": "Trainer A"}, http.StatusCreated)
	learnerB := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "learner-b@example.test", "name": "Learner B"}, http.StatusCreated)
	_ = postJSON[core.Membership](t, server, "/v1/tenants/"+tenantA.ID+"/memberships", map[string]any{"user_id": learnerA.ID, "role": string(core.RoleLearner)}, http.StatusCreated)
	_ = postJSON[core.Membership](t, server, "/v1/tenants/"+tenantA.ID+"/memberships", map[string]any{"user_id": trainerA.ID, "role": string(core.RoleTrainer)}, http.StatusCreated)
	_ = postJSON[core.Membership](t, server, "/v1/tenants/"+tenantB.ID+"/memberships", map[string]any{"user_id": learnerB.ID, "role": string(core.RoleLearner)}, http.StatusCreated)
	enrollmentA := postJSON[core.CohortEnrollment](t, server, "/v1/tenants/"+tenantA.ID+"/cohorts/"+cohortA.ID+"/enrollments", map[string]any{"learner_id": learnerA.ID}, http.StatusCreated)
	_ = postJSON[core.CohortEnrollment](t, server, "/v1/tenants/"+tenantB.ID+"/cohorts/"+cohortB.ID+"/enrollments", map[string]any{"learner_id": learnerB.ID}, http.StatusCreated)

	tenants := getJSON[[]core.Tenant](t, server, "/v1/tenants", http.StatusOK)
	if len(tenants) != 3 {
		t.Fatalf("expected three tenants, got %+v", tenants)
	}
	programs := getJSON[[]core.Program](t, server, "/v1/tenants/"+tenantA.ID+"/programs", http.StatusOK)
	if len(programs) != 1 || programs[0].ID != programA.ID || programs[0].TenantID != tenantA.ID {
		t.Fatalf("program list leaked or missed data: %+v", programs)
	}
	cohorts := getJSON[[]core.Cohort](t, server, "/v1/tenants/"+tenantA.ID+"/cohorts", http.StatusOK)
	if len(cohorts) != 1 || cohorts[0].ID != cohortA.ID || cohorts[0].TenantID != tenantA.ID {
		t.Fatalf("cohort list leaked or missed data: %+v", cohorts)
	}
	syllabi := getJSON[[]core.Syllabus](t, server, "/v1/tenants/"+tenantA.ID+"/syllabi", http.StatusOK)
	if len(syllabi) != 1 || syllabi[0].ID != syllabusA.ID || syllabi[0].TenantID != tenantA.ID {
		t.Fatalf("syllabus list leaked or missed data: %+v", syllabi)
	}
	domains := getJSON[[]core.Domain](t, server, "/v1/tenants/"+tenantA.ID+"/domains", http.StatusOK)
	if len(domains) != 1 || domains[0].ID != graphA.Domain.ID || domains[0].TenantID != tenantA.ID {
		t.Fatalf("domain list leaked or missed data: %+v", domains)
	}
	memberships := getJSON[[]core.Membership](t, server, "/v1/tenants/"+tenantA.ID+"/memberships", http.StatusOK)
	if len(memberships) != 2 {
		t.Fatalf("membership list leaked or missed data: %+v", memberships)
	}
	learners := getJSON[[]core.Learner](t, server, "/v1/tenants/"+tenantA.ID+"/learners", http.StatusOK)
	if len(learners) != 1 || learners[0].UserID != learnerA.ID || learners[0].TenantID != tenantA.ID {
		t.Fatalf("learner list leaked or missed data: %+v", learners)
	}
	enrollments := getJSON[[]core.CohortEnrollment](t, server, "/v1/tenants/"+tenantA.ID+"/cohorts/"+cohortA.ID+"/enrollments", http.StatusOK)
	if len(enrollments) != 1 || enrollments[0].LearnerID != enrollmentA.LearnerID || enrollments[0].TenantID != tenantA.ID {
		t.Fatalf("enrollment list leaked or missed data: %+v", enrollments)
	}
	expectJSONStatus(t, server, http.MethodGet, "/v1/tenants/"+tenantA.ID+"/cohorts/"+cohortB.ID+"/enrollments", nil, nil, http.StatusNotFound)
}

func TestRESTAdminCRUDSessionsAndAudit(t *testing.T) {
	server := newTestServer()
	tenantA := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	tenantB := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "B", "slug": "b"}, http.StatusCreated)
	learner := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "learner-admin@example.test", "name": "Learner"}, http.StatusCreated)
	_ = postJSON[core.Membership](t, server, "/v1/tenants/"+tenantA.ID+"/memberships", map[string]any{"user_id": learner.ID, "role": string(core.RoleLearner)}, http.StatusCreated)

	programA := postJSON[core.Program](t, server, "/v1/tenants/"+tenantA.ID+"/programs", map[string]any{"name": "Go Backend"}, http.StatusCreated)
	programB := postJSON[core.Program](t, server, "/v1/tenants/"+tenantB.ID+"/programs", map[string]any{"name": "Rust Backend"}, http.StatusCreated)
	programA = patchJSON[core.Program](t, server, "/v1/tenants/"+tenantA.ID+"/programs/"+programA.ID, map[string]any{"name": "Go Backend Advanced"}, http.StatusOK)
	if programA.Name != "Go Backend Advanced" || programA.Status != "ACTIVE" {
		t.Fatalf("program patch mismatch: %+v", programA)
	}
	expectJSONStatus(t, server, http.MethodPatch, "/v1/tenants/"+tenantA.ID+"/programs/"+programB.ID, map[string]any{"name": "Leak"}, nil, http.StatusNotFound)

	cohort := postJSON[core.Cohort](t, server, "/v1/tenants/"+tenantA.ID+"/cohorts", map[string]any{"program_id": programA.ID, "name": "June"}, http.StatusCreated)
	cohort = patchJSON[core.Cohort](t, server, "/v1/tenants/"+tenantA.ID+"/cohorts/"+cohort.ID, map[string]any{"name": "July", "status": "ACTIVE"}, http.StatusOK)
	if cohort.Name != "July" || cohort.ProgramID != programA.ID {
		t.Fatalf("cohort patch mismatch: %+v", cohort)
	}
	enrollment := postJSON[core.CohortEnrollment](t, server, "/v1/tenants/"+tenantA.ID+"/cohorts/"+cohort.ID+"/enrollments", map[string]any{"learner_id": learner.ID}, http.StatusCreated)
	enrollment = patchJSON[core.CohortEnrollment](t, server, "/v1/tenants/"+tenantA.ID+"/cohorts/"+cohort.ID+"/enrollments/"+learner.ID, map[string]any{"status": "COMPLETED"}, http.StatusOK)
	if enrollment.Status != "COMPLETED" {
		t.Fatalf("enrollment patch mismatch: %+v", enrollment)
	}

	startsAt := "2026-06-10T09:00:00Z"
	session := postJSON[core.TrainingSession](t, server, "/v1/tenants/"+tenantA.ID+"/training-sessions", map[string]any{
		"cohort_id": cohort.ID,
		"title":     "Seance 1",
		"starts_at": startsAt,
		"ends_at":   "2026-06-10T11:00:00Z",
		"capacity":  12,
		"location":  "Lyon",
		"video_url": "https://video.example.test/s1",
	}, http.StatusCreated)
	if session.ProgramID != programA.ID || session.Status != "SCHEDULED" {
		t.Fatalf("training session create mismatch: %+v", session)
	}
	session = patchJSON[core.TrainingSession](t, server, "/v1/tenants/"+tenantA.ID+"/training-sessions/"+session.ID, map[string]any{"capacity": 10}, http.StatusOK)
	if session.Capacity != 10 {
		t.Fatalf("training session patch mismatch: %+v", session)
	}
	expectJSONStatus(t, server, http.MethodDelete, "/v1/tenants/"+tenantA.ID+"/training-sessions/"+session.ID, nil, nil, http.StatusOK)

	tenantUser := patchJSON[core.TenantUser](t, server, "/v1/tenants/"+tenantA.ID+"/users/"+learner.ID, map[string]any{"name": "Learner Two"}, http.StatusOK)
	if tenantUser.Name != "Learner Two" || tenantUser.Role != core.RoleLearner {
		t.Fatalf("tenant user patch mismatch: %+v", tenantUser)
	}
	expectJSONStatus(t, server, http.MethodDelete, "/v1/tenants/"+tenantA.ID+"/users/"+learner.ID, nil, nil, http.StatusOK)
	users := getJSON[[]core.TenantUser](t, server, "/v1/tenants/"+tenantA.ID+"/users", http.StatusOK)
	if len(users) != 1 || users[0].MembershipStatus != "ARCHIVED" {
		t.Fatalf("tenant user list mismatch: %+v", users)
	}

	sessions := getJSON[[]core.TrainingSession](t, server, "/v1/tenants/"+tenantA.ID+"/training-sessions?cohort_id="+cohort.ID, http.StatusOK)
	if len(sessions) != 1 || sessions[0].ID != session.ID || sessions[0].Status != "ARCHIVED" {
		t.Fatalf("training session list mismatch: %+v", sessions)
	}
	audit := getJSON[[]core.AdminAuditLog](t, server, "/v1/tenants/"+tenantA.ID+"/admin-audit-logs?target_type=training_session&target_id="+session.ID, http.StatusOK)
	if len(audit) != 3 {
		t.Fatalf("expected create/update/archive session audit entries, got %+v", audit)
	}
}

func TestJWTListEndpointsAuthorizeRoles(t *testing.T) {
	server := newTestServerWithJWT()
	tenantA := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	tenantB := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "B", "slug": "b"}, http.StatusCreated)
	superUser := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "super@example.test", "name": "Super"}, http.StatusCreated)
	admin := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "admin@example.test", "name": "Admin"}, http.StatusCreated)
	trainer := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "trainer@example.test", "name": "Trainer"}, http.StatusCreated)
	learner := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "learner@example.test", "name": "Learner"}, http.StatusCreated)
	otherTrainer := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "other-trainer@example.test", "name": "Other Trainer"}, http.StatusCreated)

	_ = postJSONWithHeadersValue[core.Membership](t, server, "/v1/tenants/"+tenantA.ID+"/memberships", map[string]any{"user_id": superUser.ID, "role": string(core.RoleSuperAdmin)}, bootstrapHeaders(), http.StatusCreated)
	_ = postJSONWithHeadersValue[core.Membership](t, server, "/v1/tenants/"+tenantA.ID+"/memberships", map[string]any{"user_id": admin.ID, "role": string(core.RoleTenantAdmin)}, bootstrapHeaders(), http.StatusCreated)
	_ = postJSONWithHeadersValue[core.Membership](t, server, "/v1/tenants/"+tenantA.ID+"/memberships", map[string]any{"user_id": trainer.ID, "role": string(core.RoleTrainer)}, bootstrapHeaders(), http.StatusCreated)
	_ = postJSONWithHeadersValue[core.Membership](t, server, "/v1/tenants/"+tenantA.ID+"/memberships", map[string]any{"user_id": learner.ID, "role": string(core.RoleLearner)}, bootstrapHeaders(), http.StatusCreated)
	_ = postJSONWithHeadersValue[core.Membership](t, server, "/v1/tenants/"+tenantB.ID+"/memberships", map[string]any{"user_id": otherTrainer.ID, "role": string(core.RoleTrainer)}, bootstrapHeaders(), http.StatusCreated)

	superToken := postJSONWithHeadersValue[map[string]string](t, server, "/v1/auth/token", map[string]any{"tenant_id": tenantA.ID, "user_id": superUser.ID}, bootstrapHeaders(), http.StatusOK)["access_token"]
	adminToken := postJSONWithHeadersValue[map[string]string](t, server, "/v1/auth/token", map[string]any{"tenant_id": tenantA.ID, "user_id": admin.ID}, bootstrapHeaders(), http.StatusOK)["access_token"]
	trainerToken := postJSONWithHeadersValue[map[string]string](t, server, "/v1/auth/token", map[string]any{"tenant_id": tenantA.ID, "user_id": trainer.ID}, bootstrapHeaders(), http.StatusOK)["access_token"]
	learnerToken := postJSONWithHeadersValue[map[string]string](t, server, "/v1/auth/token", map[string]any{"tenant_id": tenantA.ID, "user_id": learner.ID}, bootstrapHeaders(), http.StatusOK)["access_token"]
	otherToken := postJSONWithHeadersValue[map[string]string](t, server, "/v1/auth/token", map[string]any{"tenant_id": tenantB.ID, "user_id": otherTrainer.ID}, bootstrapHeaders(), http.StatusOK)["access_token"]

	expectJSONStatus(t, server, http.MethodGet, "/v1/tenants", nil, nil, http.StatusUnauthorized)
	expectJSONStatus(t, server, http.MethodGet, "/v1/tenants", nil, bearerHeaders(adminToken), http.StatusForbidden)
	if tenants := getJSONWithHeaders[[]core.Tenant](t, server, "/v1/tenants", bearerHeaders(superToken), http.StatusOK); len(tenants) != 2 {
		t.Fatalf("super-admin tenant list mismatch: %+v", tenants)
	}

	program := postJSONWithHeadersValue[core.Program](t, server, "/v1/tenants/"+tenantA.ID+"/programs", map[string]any{"name": "Go Backend"}, bearerHeaders(adminToken), http.StatusCreated)
	cohort := postJSONWithHeadersValue[core.Cohort](t, server, "/v1/tenants/"+tenantA.ID+"/cohorts", map[string]any{"program_id": program.ID, "name": "June"}, bearerHeaders(adminToken), http.StatusCreated)
	_ = postJSONWithHeadersValue[core.CohortEnrollment](t, server, "/v1/tenants/"+tenantA.ID+"/cohorts/"+cohort.ID+"/enrollments", map[string]any{"learner_id": learner.ID}, bearerHeaders(adminToken), http.StatusCreated)
	_ = postJSONWithHeadersValue[core.Syllabus](t, server, "/v1/tenants/"+tenantA.ID+"/syllabi", map[string]any{"title": "Go Syllabus"}, bearerHeaders(adminToken), http.StatusCreated)
	_ = postJSONWithHeadersValue[core.DomainGraph](t, server, "/v1/tenants/"+tenantA.ID+"/domains", map[string]any{
		"owner_id": trainer.ID,
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{{"id": "go-c1", "name": "HTTP", "difficulty": 0.4}},
	}, bearerHeaders(trainerToken), http.StatusCreated)

	for _, path := range []string{
		"/v1/tenants/" + tenantA.ID + "/programs",
		"/v1/tenants/" + tenantA.ID + "/cohorts",
		"/v1/tenants/" + tenantA.ID + "/cohorts/" + cohort.ID + "/enrollments",
		"/v1/tenants/" + tenantA.ID + "/syllabi",
		"/v1/tenants/" + tenantA.ID + "/domains",
		"/v1/tenants/" + tenantA.ID + "/memberships",
		"/v1/tenants/" + tenantA.ID + "/learners",
	} {
		expectJSONStatus(t, server, http.MethodGet, path, nil, nil, http.StatusUnauthorized)
		expectJSONStatus(t, server, http.MethodGet, path, nil, bearerHeaders(otherToken), http.StatusForbidden)
		expectJSONStatus(t, server, http.MethodGet, path, nil, bearerHeaders(learnerToken), http.StatusForbidden)
		_ = getJSONWithHeaders[[]map[string]any](t, server, path, bearerHeaders(adminToken), http.StatusOK)
		_ = getJSONWithHeaders[[]map[string]any](t, server, path, bearerHeaders(trainerToken), http.StatusOK)
		_ = getJSONWithHeaders[[]map[string]any](t, server, path, bearerHeaders(superToken), http.StatusOK)
	}
}

func TestJWTAdminMutationsRequireTenantAdmin(t *testing.T) {
	server := newTestServerWithJWT()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	admin := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "admin-b12@example.test", "name": "Admin"}, http.StatusCreated)
	trainer := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "trainer-b12@example.test", "name": "Trainer"}, http.StatusCreated)
	learner := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "learner-b12@example.test", "name": "Learner"}, http.StatusCreated)
	_ = postJSONWithHeadersValue[core.Membership](t, server, "/v1/tenants/"+tenant.ID+"/memberships", map[string]any{"user_id": admin.ID, "role": string(core.RoleTenantAdmin)}, bootstrapHeaders(), http.StatusCreated)
	_ = postJSONWithHeadersValue[core.Membership](t, server, "/v1/tenants/"+tenant.ID+"/memberships", map[string]any{"user_id": trainer.ID, "role": string(core.RoleTrainer)}, bootstrapHeaders(), http.StatusCreated)
	_ = postJSONWithHeadersValue[core.Membership](t, server, "/v1/tenants/"+tenant.ID+"/memberships", map[string]any{"user_id": learner.ID, "role": string(core.RoleLearner)}, bootstrapHeaders(), http.StatusCreated)
	adminToken := postJSONWithHeadersValue[map[string]string](t, server, "/v1/auth/token", map[string]any{"tenant_id": tenant.ID, "user_id": admin.ID}, bootstrapHeaders(), http.StatusOK)["access_token"]
	trainerToken := postJSONWithHeadersValue[map[string]string](t, server, "/v1/auth/token", map[string]any{"tenant_id": tenant.ID, "user_id": trainer.ID}, bootstrapHeaders(), http.StatusOK)["access_token"]
	learnerToken := postJSONWithHeadersValue[map[string]string](t, server, "/v1/auth/token", map[string]any{"tenant_id": tenant.ID, "user_id": learner.ID}, bootstrapHeaders(), http.StatusOK)["access_token"]

	expectJSONStatus(t, server, http.MethodPost, "/v1/tenants/"+tenant.ID+"/programs", map[string]any{"name": "Denied"}, bearerHeaders(trainerToken), http.StatusForbidden)
	program := postJSONWithHeadersValue[core.Program](t, server, "/v1/tenants/"+tenant.ID+"/programs", map[string]any{"name": "Go Backend"}, bearerHeaders(adminToken), http.StatusCreated)
	expectJSONStatus(t, server, http.MethodPatch, "/v1/tenants/"+tenant.ID+"/programs/"+program.ID, map[string]any{"name": "Denied"}, bearerHeaders(trainerToken), http.StatusForbidden)
	expectJSONStatus(t, server, http.MethodGet, "/v1/tenants/"+tenant.ID+"/users", nil, bearerHeaders(learnerToken), http.StatusForbidden)

	cohort := postJSONWithHeadersValue[core.Cohort](t, server, "/v1/tenants/"+tenant.ID+"/cohorts", map[string]any{"program_id": program.ID, "name": "June"}, bearerHeaders(adminToken), http.StatusCreated)
	session := postJSONWithHeadersValue[core.TrainingSession](t, server, "/v1/tenants/"+tenant.ID+"/training-sessions", map[string]any{
		"cohort_id": cohort.ID,
		"title":     "Seance 1",
		"starts_at": "2026-06-10T09:00:00Z",
		"ends_at":   "2026-06-10T11:00:00Z",
	}, bearerHeaders(adminToken), http.StatusCreated)
	expectJSONStatus(t, server, http.MethodDelete, "/v1/tenants/"+tenant.ID+"/training-sessions/"+session.ID, nil, bearerHeaders(trainerToken), http.StatusForbidden)
	expectJSONStatus(t, server, http.MethodDelete, "/v1/tenants/"+tenant.ID+"/training-sessions/"+session.ID, nil, bearerHeaders(adminToken), http.StatusOK)
}

func TestTenantMembershipEmitsUserCreatedEvent(t *testing.T) {
	server := newTestServer()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	user := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "u@example.test", "name": "U"}, http.StatusCreated)

	_ = postJSON[core.Membership](t, server, "/v1/tenants/"+tenant.ID+"/memberships", map[string]any{
		"user_id": user.ID,
		"role":    string(core.RoleTrainer),
	}, http.StatusCreated)
	_ = postJSON[core.Membership](t, server, "/v1/tenants/"+tenant.ID+"/memberships", map[string]any{
		"user_id": user.ID,
		"role":    string(core.RoleTenantAdmin),
	}, http.StatusCreated)

	events := getJSON[[]core.Event](t, server, "/v1/tenants/"+tenant.ID+"/events/outbox?published=false", http.StatusOK)
	if countEventType(events, "UserCreated") != 1 {
		t.Fatalf("expected one UserCreated tenant event, got events=%+v", events)
	}
	if countEventType(events, "MembershipChanged") != 2 {
		t.Fatalf("expected membership changes for create and role update, got events=%+v", events)
	}
}

func TestJWTProtectsTenantScopedRoutes(t *testing.T) {
	server := newTestServerWithJWT()
	tenantA := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	tenantB := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "B", "slug": "b"}, http.StatusCreated)
	userA := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "a@example.test", "name": "A"}, http.StatusCreated)
	userB := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "b@example.test", "name": "B"}, http.StatusCreated)
	_, _ = postJSONWithHeaders[core.Membership](t, server, "/v1/tenants/"+tenantA.ID+"/memberships", map[string]any{"user_id": userA.ID, "role": string(core.RoleTrainer)}, bootstrapHeaders(), http.StatusCreated)
	_, _ = postJSONWithHeaders[core.Membership](t, server, "/v1/tenants/"+tenantB.ID+"/memberships", map[string]any{"user_id": userB.ID, "role": string(core.RoleTrainer)}, bootstrapHeaders(), http.StatusCreated)

	tokenA := postJSONWithHeadersValue[map[string]string](t, server, "/v1/auth/token", map[string]any{"tenant_id": tenantA.ID, "user_id": userA.ID}, bootstrapHeaders(), http.StatusOK)["access_token"]
	tokenB := postJSONWithHeadersValue[map[string]string](t, server, "/v1/auth/token", map[string]any{"tenant_id": tenantB.ID, "user_id": userB.ID}, bootstrapHeaders(), http.StatusOK)["access_token"]

	req := httptest.NewRequest(http.MethodPost, "/v1/tenants/"+tenantA.ID+"/domains", jsonBody(map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{{"id": "c1", "name": "HTTP", "difficulty": 0.4}},
	}))
	resp := httptest.NewRecorder()
	server.ServeHTTP(resp, req)
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("missing bearer status=%d body=%s", resp.Code, resp.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/tenants/"+tenantA.ID+"/domains", jsonBody(map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{{"id": "c1", "name": "HTTP", "difficulty": 0.4}},
	}))
	req.Header.Set("Authorization", "Bearer "+tokenB)
	resp = httptest.NewRecorder()
	server.ServeHTTP(resp, req)
	if resp.Code != http.StatusForbidden {
		t.Fatalf("wrong-tenant bearer status=%d body=%s", resp.Code, resp.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/tenants/"+tenantA.ID+"/domains", jsonBody(map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{{"id": "c1", "name": "HTTP", "difficulty": 0.4}},
	}))
	req.Header.Set("Authorization", "Bearer "+tokenA)
	resp = httptest.NewRecorder()
	server.ServeHTTP(resp, req)
	if resp.Code != http.StatusCreated {
		t.Fatalf("valid bearer status=%d body=%s", resp.Code, resp.Body.String())
	}
}

func TestJWTRoleRestrictsLearnerRoutes(t *testing.T) {
	server := newTestServerWithJWT()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	trainer := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "trainer@example.test", "name": "Trainer"}, http.StatusCreated)
	learner := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "learner@example.test", "name": "Learner"}, http.StatusCreated)
	_, _ = postJSONWithHeaders[core.Membership](t, server, "/v1/tenants/"+tenant.ID+"/memberships", map[string]any{"user_id": trainer.ID, "role": string(core.RoleTrainer)}, bootstrapHeaders(), http.StatusCreated)
	_, _ = postJSONWithHeaders[core.Membership](t, server, "/v1/tenants/"+tenant.ID+"/memberships", map[string]any{"user_id": learner.ID, "role": string(core.RoleLearner)}, bootstrapHeaders(), http.StatusCreated)
	trainerToken := postJSONWithHeadersValue[map[string]string](t, server, "/v1/auth/token", map[string]any{"tenant_id": tenant.ID, "user_id": trainer.ID}, bootstrapHeaders(), http.StatusOK)["access_token"]
	learnerToken := postJSONWithHeadersValue[map[string]string](t, server, "/v1/auth/token", map[string]any{"tenant_id": tenant.ID, "user_id": learner.ID}, bootstrapHeaders(), http.StatusOK)["access_token"]

	domainBody := map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{{"id": "c1", "name": "HTTP", "difficulty": 0.4}},
	}
	graph, _ := postJSONWithHeaders[core.DomainGraph](t, server, "/v1/tenants/"+tenant.ID+"/domains", domainBody, bearerHeaders(trainerToken), http.StatusCreated)
	expectJSONStatus(t, server, http.MethodPost, "/v1/tenants/"+tenant.ID+"/domains", domainBody, bearerHeaders(learnerToken), http.StatusForbidden)

	decision, _ := postJSONWithHeaders[core.RuntimeDecision](t, server, "/v1/tenants/"+tenant.ID+"/learners/"+learner.ID+"/activities/next", map[string]any{
		"domain_id": graph.Domain.ID,
	}, bearerHeaders(learnerToken), http.StatusCreated)
	expectJSONStatus(t, server, http.MethodPost, "/v1/tenants/"+tenant.ID+"/learners/other-learner/activities/next", map[string]any{
		"domain_id": graph.Domain.ID,
	}, bearerHeaders(learnerToken), http.StatusForbidden)
	expectJSONStatus(t, server, http.MethodPost, "/v1/tenants/"+tenant.ID+"/assessments/"+decision.Activity.ID+"/submit", map[string]any{
		"learner_id": "other-learner",
		"answers": []map[string]any{
			{"item_id": "concept-check", "choice_id": decision.Activity.ConceptID},
		},
	}, bearerHeaders(learnerToken), http.StatusForbidden)

	_ = postJSON[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/assessments/"+decision.Activity.ID+"/submit", map[string]any{
		"learner_id": learner.ID,
		"answers": []map[string]any{
			{"item_id": "concept-check", "choice_id": decision.Activity.ConceptID},
		},
	}, http.StatusUnauthorized)
	_, _ = postJSONWithHeaders[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/assessments/"+decision.Activity.ID+"/submit", map[string]any{
		"learner_id": learner.ID,
		"answers": []map[string]any{
			{"item_id": "concept-check", "choice_id": decision.Activity.ConceptID},
		},
	}, bearerHeaders(learnerToken), http.StatusCreated)
	getJSONWithHeaders[[]core.LearnerState](t, server, "/v1/tenants/"+tenant.ID+"/learners/"+learner.ID+"/state", bearerHeaders(learnerToken), http.StatusOK)
}

// TestAuthBootstrapBypassIsClosed asserts the previously chained privilege
// escalation is gone: with JWT enabled an unauthenticated caller can neither
// add a membership nor mint a token.
func TestAuthBootstrapBypassIsClosed(t *testing.T) {
	server := newTestServerWithJWT()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	user := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "u@example.test", "name": "U"}, http.StatusCreated)

	// No bootstrap secret and no bearer token: membership write is rejected.
	expectJSONStatus(t, server, http.MethodPost, "/v1/tenants/"+tenant.ID+"/memberships",
		map[string]any{"user_id": user.ID, "role": string(core.RoleSuperAdmin)}, nil, http.StatusUnauthorized)
	// Token minting is rejected too, so the self-grant chain cannot start.
	expectJSONStatus(t, server, http.MethodPost, "/v1/auth/token",
		map[string]any{"tenant_id": tenant.ID, "user_id": user.ID}, nil, http.StatusUnauthorized)
	// A wrong bootstrap secret must not authorize either.
	expectJSONStatus(t, server, http.MethodPost, "/v1/tenants/"+tenant.ID+"/memberships",
		map[string]any{"user_id": user.ID, "role": string(core.RoleTrainer)},
		map[string]string{"X-LORE-Bootstrap-Token": "wrong"}, http.StatusUnauthorized)
}

func TestAuthTokenEndpointLocksOutRepeatedFailures(t *testing.T) {
	server := newTestServerWithJWT()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	user := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "u@example.test", "name": "U"}, http.StatusCreated)
	_, _ = postJSONWithHeaders[core.Membership](t, server, "/v1/tenants/"+tenant.ID+"/memberships", map[string]any{"user_id": user.ID, "role": string(core.RoleTrainer)}, bootstrapHeaders(), http.StatusCreated)

	body := map[string]any{"tenant_id": tenant.ID, "user_id": user.ID}
	headers := map[string]string{"X-Forwarded-For": "203.0.113.10"}
	for i := 0; i < 5; i++ {
		expectJSONStatus(t, server, http.MethodPost, "/v1/auth/token", body, headers, http.StatusUnauthorized)
	}
	expectJSONStatus(t, server, http.MethodPost, "/v1/auth/token", body, headers, http.StatusTooManyRequests)

	// A different client is not locked out by the previous client's failures.
	token := postJSONWithHeadersValue[map[string]string](t, server, "/v1/auth/token", body,
		map[string]string{
			"X-Forwarded-For":        "203.0.113.11",
			"X-LORE-Bootstrap-Token": testBootstrapToken,
		}, http.StatusOK)["access_token"]
	if token == "" {
		t.Fatalf("expected token for a different client")
	}
}

// TestInvalidMembershipRoleRejected covers the role-enum validation in both the
// open (no-JWT) handler path and the store defense-in-depth layer.
func TestInvalidMembershipRoleRejected(t *testing.T) {
	server := newTestServer()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	user := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "u@example.test", "name": "U"}, http.StatusCreated)
	expectJSONStatus(t, server, http.MethodPost, "/v1/tenants/"+tenant.ID+"/memberships",
		map[string]any{"user_id": user.ID, "role": "WIZARD"}, nil, http.StatusBadRequest)
}

// TestTenantAdminCannotGrantSuperAdmin asserts a tenant administrator can grant
// ordinary roles but not escalate anyone to SUPER_ADMIN, while a super-admin
// can.
func TestTenantAdminCannotGrantSuperAdmin(t *testing.T) {
	server := newTestServerWithJWT()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	admin := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "admin@example.test", "name": "Admin"}, http.StatusCreated)
	super := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "super@example.test", "name": "Super"}, http.StatusCreated)
	target := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "t@example.test", "name": "Target"}, http.StatusCreated)

	_, _ = postJSONWithHeaders[core.Membership](t, server, "/v1/tenants/"+tenant.ID+"/memberships", map[string]any{"user_id": admin.ID, "role": string(core.RoleTenantAdmin)}, bootstrapHeaders(), http.StatusCreated)
	_, _ = postJSONWithHeaders[core.Membership](t, server, "/v1/tenants/"+tenant.ID+"/memberships", map[string]any{"user_id": super.ID, "role": string(core.RoleSuperAdmin)}, bootstrapHeaders(), http.StatusCreated)
	adminToken := postJSONWithHeadersValue[map[string]string](t, server, "/v1/auth/token", map[string]any{"tenant_id": tenant.ID, "user_id": admin.ID}, bootstrapHeaders(), http.StatusOK)["access_token"]
	superToken := postJSONWithHeadersValue[map[string]string](t, server, "/v1/auth/token", map[string]any{"tenant_id": tenant.ID, "user_id": super.ID}, bootstrapHeaders(), http.StatusOK)["access_token"]

	// Tenant admin may grant an ordinary role.
	expectJSONStatus(t, server, http.MethodPost, "/v1/tenants/"+tenant.ID+"/memberships",
		map[string]any{"user_id": target.ID, "role": string(core.RoleTrainer)}, bearerHeaders(adminToken), http.StatusCreated)
	// Tenant admin may NOT escalate to SUPER_ADMIN.
	expectJSONStatus(t, server, http.MethodPost, "/v1/tenants/"+tenant.ID+"/memberships",
		map[string]any{"user_id": target.ID, "role": string(core.RoleSuperAdmin)}, bearerHeaders(adminToken), http.StatusForbidden)
	// A super-admin may.
	expectJSONStatus(t, server, http.MethodPost, "/v1/tenants/"+tenant.ID+"/memberships",
		map[string]any{"user_id": target.ID, "role": string(core.RoleSuperAdmin)}, bearerHeaders(superToken), http.StatusCreated)
}

// TestIssuedTokenTTLIsCapped asserts an oversized ttl_seconds request cannot
// mint a long-lived token.
func TestIssuedTokenTTLIsCapped(t *testing.T) {
	server := newTestServerWithJWT()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	user := postJSON[core.User](t, server, "/v1/users", map[string]any{"email": "u@example.test", "name": "U"}, http.StatusCreated)
	_, _ = postJSONWithHeaders[core.Membership](t, server, "/v1/tenants/"+tenant.ID+"/memberships", map[string]any{"user_id": user.ID, "role": string(core.RoleTrainer)}, bootstrapHeaders(), http.StatusCreated)

	token := postJSONWithHeadersValue[map[string]string](t, server, "/v1/auth/token",
		map[string]any{"tenant_id": tenant.ID, "user_id": user.ID, "ttl_seconds": 60 * 60 * 24 * 365}, bootstrapHeaders(), http.StatusOK)["access_token"]

	iat, exp := tokenLifetime(t, token)
	if lifetime := exp - iat; lifetime > int64((24*time.Hour)/time.Second) {
		t.Fatalf("token lifetime %ds exceeds 24h cap", lifetime)
	}
}

func tokenLifetime(t *testing.T, token string) (iat, exp int64) {
	t.Helper()
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("malformed token: %q", token)
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("decode token payload: %v", err)
	}
	var claims struct {
		IssuedAt int64 `json:"iat"`
		Expires  int64 `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		t.Fatalf("unmarshal claims: %v", err)
	}
	return claims.IssuedAt, claims.Expires
}

// TestRS256VerifyOnlyServerAcceptsExternalTokensAndDelegatesIssuance exercises
// the OIDC boundary: the server holds only a public key, so it verifies
// externally-issued RS256 tokens on tenant routes but refuses to mint tokens.
func TestRS256VerifyOnlyServerAcceptsExternalTokensAndDelegatesIssuance(t *testing.T) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	issuer, err := auth.NewRS256TokenService(priv, &priv.PublicKey)
	if err != nil {
		t.Fatalf("issuer: %v", err)
	}

	mem := store.NewMemoryStore()
	engine := runtime.NewEngine(mem).WithClock(func() time.Time {
		return time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	})
	server := httpapi.NewServer(mem, engine, llm.InstructionOnlyGenerator{Provider: "instruction_only", Model: "runtime"}, "instruction_only", "runtime")
	verifier, err := auth.NewRS256TokenService(nil, &priv.PublicKey)
	if err != nil {
		t.Fatalf("verifier: %v", err)
	}
	server.EnableJWTService(verifier)
	server.EnableBootstrap(testBootstrapToken)
	h := server.Handler()

	tenant := postJSON[core.Tenant](t, h, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	user := postJSON[core.User](t, h, "/v1/users", map[string]any{"email": "u@example.test", "name": "U"}, http.StatusCreated)
	_ = postJSONWithHeadersValue[core.Membership](t, h, "/v1/tenants/"+tenant.ID+"/memberships",
		map[string]any{"user_id": user.ID, "role": string(core.RoleTrainer)}, bootstrapHeaders(), http.StatusCreated)

	// Issuance is delegated to the IdP: the local endpoint refuses.
	expectJSONStatus(t, h, http.MethodPost, "/v1/auth/token",
		map[string]any{"tenant_id": tenant.ID, "user_id": user.ID}, bootstrapHeaders(), http.StatusNotImplemented)

	// An externally-issued RS256 token is accepted on a tenant-scoped route.
	external, err := issuer.Issue(user.ID, tenant.ID, string(core.RoleTrainer), time.Hour)
	if err != nil {
		t.Fatalf("issue external token: %v", err)
	}
	_ = postJSONWithHeadersValue[core.DomainGraph](t, h, "/v1/tenants/"+tenant.ID+"/domains", map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{{"id": "c1", "name": "HTTP", "difficulty": 0.4}},
	}, bearerHeaders(external), http.StatusCreated)

	// A token signed by a different key is rejected.
	otherPriv, _ := rsa.GenerateKey(rand.Reader, 2048)
	otherIssuer, _ := auth.NewRS256TokenService(otherPriv, &otherPriv.PublicKey)
	forged, _ := otherIssuer.Issue(user.ID, tenant.ID, string(core.RoleTrainer), time.Hour)
	expectJSONStatus(t, h, http.MethodPost, "/v1/tenants/"+tenant.ID+"/domains", map[string]any{
		"owner_id": "trainer", "name": "Go", "source": "TRAINER",
		"concepts": []map[string]any{{"id": "c2", "name": "X", "difficulty": 0.4}},
	}, bearerHeaders(forged), http.StatusUnauthorized)
}

func TestMetricsEndpointExposesHTTPMetrics(t *testing.T) {
	server := newTestServer()
	// Generate some traffic so the counters have something to report.
	_ = getJSON[map[string]string](t, server, "/health", http.StatusOK)

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	resp := httptest.NewRecorder()
	server.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("metrics status=%d body=%s", resp.Code, resp.Body.String())
	}
	body := resp.Body.String()
	for _, want := range []string{
		"lore_http_requests_total",
		"lore_http_request_duration_seconds",
		"lore_http_requests_in_flight",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("metrics output missing %q", want)
		}
	}
	// The route label uses the matched template, not the raw path, keeping
	// cardinality bounded.
	if !strings.Contains(body, `route="GET /health"`) {
		t.Fatalf("expected a bounded route label for /health, body=%s", body)
	}
}

func TestMetricsEndpointRequiresConfiguredToken(t *testing.T) {
	mem := store.NewMemoryStore()
	engine := runtime.NewEngine(mem)
	serverBuilder := httpapi.NewServer(mem, engine, llm.InstructionOnlyGenerator{Provider: "instruction_only", Model: "runtime"}, "instruction_only", "runtime")
	serverBuilder.EnableMetricsToken("0123456789abcdef0123456789abcdef")
	server := serverBuilder.Handler()

	for _, tc := range []struct {
		name   string
		header string
		value  string
		status int
	}{
		{name: "missing", status: http.StatusUnauthorized},
		{name: "wrong bearer", header: "Authorization", value: "Bearer wrong", status: http.StatusUnauthorized},
		{name: "bearer", header: "Authorization", value: "Bearer 0123456789abcdef0123456789abcdef", status: http.StatusOK},
		{name: "scrape header", header: "X-LORE-Metrics-Token", value: "0123456789abcdef0123456789abcdef", status: http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
			if tc.header != "" {
				req.Header.Set(tc.header, tc.value)
			}
			resp := httptest.NewRecorder()
			server.ServeHTTP(resp, req)
			if resp.Code != tc.status {
				t.Fatalf("metrics status=%d want=%d body=%s", resp.Code, tc.status, resp.Body.String())
			}
			if tc.status == http.StatusUnauthorized && resp.Header().Get("WWW-Authenticate") == "" {
				t.Fatalf("missing WWW-Authenticate header")
			}
		})
	}
}

func TestLearnerStateCacheIsPopulatedAndInvalidated(t *testing.T) {
	mem := store.NewMemoryStore()
	engine := runtime.NewEngine(mem).WithClock(func() time.Time {
		return time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	})
	c := newFakeCache()
	serverBuilder := httpapi.NewServer(mem, engine, llm.InstructionOnlyGenerator{Provider: "instruction_only", Model: "runtime"}, "instruction_only", "runtime")
	serverBuilder.EnableCache(c)
	server := serverBuilder.Handler()

	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	graph := postJSON[core.DomainGraph](t, server, "/v1/tenants/"+tenant.ID+"/domains", map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{{"id": "c1", "name": "HTTP", "difficulty": 0.4}},
	}, http.StatusCreated)
	decision := postJSON[core.RuntimeDecision](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/activities/next", map[string]any{"domain_id": graph.Domain.ID}, http.StatusCreated)

	first := httptest.NewRecorder()
	server.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/v1/tenants/"+tenant.ID+"/learners/l1/state", nil))
	if first.Code != http.StatusOK {
		t.Fatalf("first state status=%d body=%s", first.Code, first.Body.String())
	}
	second := httptest.NewRecorder()
	server.ServeHTTP(second, httptest.NewRequest(http.MethodGet, "/v1/tenants/"+tenant.ID+"/learners/l1/state", nil))
	if second.Header().Get("X-LORE-Cache") != "hit" {
		t.Fatalf("expected second state read to hit cache")
	}

	_ = postJSON[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/assessments/"+decision.Activity.ID+"/submit", correctedAssessmentBody("l1", decision.Activity.ConceptID), http.StatusCreated)
	if c.deleteCount == 0 {
		t.Fatalf("expected interaction to invalidate learner state cache")
	}
}

func newTestServer() http.Handler {
	mem := store.NewMemoryStore()
	engine := runtime.NewEngine(mem).WithClock(func() time.Time {
		return time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	})
	return httpapi.NewServer(mem, engine, llm.InstructionOnlyGenerator{Provider: "instruction_only", Model: "runtime"}, "instruction_only", "runtime").Handler()
}

type fakeCache struct {
	mu          sync.Mutex
	values      map[string][]byte
	deleteCount int
}

func newFakeCache() *fakeCache {
	return &fakeCache{values: map[string][]byte{}}
}

func (c *fakeCache) Get(_ context.Context, key string) ([]byte, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	value, ok := c.values[key]
	if !ok {
		return nil, cache.ErrCacheMiss
	}
	return value, nil
}

func (c *fakeCache) Set(_ context.Context, key string, value []byte, _ time.Duration) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.values[key] = append([]byte(nil), value...)
	return nil
}

func (c *fakeCache) Delete(_ context.Context, key string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.values[key]; !ok {
		return errors.New("expected key to exist before delete")
	}
	delete(c.values, key)
	c.deleteCount++
	return nil
}

func newTestServerWithJWT() http.Handler {
	mem := store.NewMemoryStore()
	engine := runtime.NewEngine(mem).WithClock(func() time.Time {
		return time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	})
	server := httpapi.NewServer(mem, engine, llm.InstructionOnlyGenerator{Provider: "instruction_only", Model: "runtime"}, "instruction_only", "runtime")
	server.EnableJWT("test-secret")
	server.EnableBootstrap(testBootstrapToken)
	return server.Handler()
}

const testBootstrapToken = "test-bootstrap-secret"

func bootstrapHeaders() map[string]string {
	return map[string]string{"X-LORE-Bootstrap-Token": testBootstrapToken}
}

// B-26: trainer bank questions drive runtime assessments (keys server-side),
// and a graded devoir bridges into BKT as corrected evidence.
func TestQuestionBankAndAssignments(t *testing.T) {
	server := newTestServer()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	graph := postJSON[core.DomainGraph](t, server, "/v1/tenants/"+tenant.ID+"/domains", map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{{"id": "c1", "name": "HTTP", "difficulty": 0.4}},
	}, http.StatusCreated)
	program := postJSON[core.Program](t, server, "/v1/tenants/"+tenant.ID+"/programs", map[string]any{"name": "Go"}, http.StatusCreated)
	cohort := postJSON[core.Cohort](t, server, "/v1/tenants/"+tenant.ID+"/cohorts", map[string]any{"program_id": program.ID, "name": "June"}, http.StatusCreated)

	// Trainer authors a question on c1; the runtime now assesses with it.
	question := postJSON[core.BankQuestion](t, server, "/v1/tenants/"+tenant.ID+"/questions", map[string]any{
		"concept_id":        "c1",
		"kind":              "single_choice",
		"prompt":            "Quel code HTTP pour une création réussie ?",
		"choices":           []map[string]any{{"id": "200", "label": "200"}, {"id": "201", "label": "201"}},
		"correct_choice_id": "201",
	}, http.StatusCreated)
	if question.CorrectChoiceID != "201" {
		t.Fatalf("question not stored: %+v", question)
	}
	decision := postJSON[core.RuntimeDecision](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/activities/next", map[string]any{
		"domain_id": graph.Domain.ID,
	}, http.StatusCreated)
	items, _ := decision.TutorInstruction.Context["assessment_items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected the bank question as assessment item: %+v", decision.TutorInstruction.Context)
	}
	first, _ := items[0].(map[string]any)
	if first["id"] != question.ID {
		t.Fatalf("assessment did not use the bank question: %+v", first)
	}
	if _, leaked := first["correct_choice_id"]; leaked {
		t.Fatalf("answer key leaked to the learner: %+v", first)
	}
	// Wrong answer scores 0; the correction names the real key.
	delta := postJSON[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/assessments/"+decision.Activity.ID+"/submit", map[string]any{
		"learner_id": "l1",
		"answers":    []map[string]any{{"item_id": question.ID, "choice_id": "200"}},
	}, http.StatusCreated)
	if delta.Interaction.Score != 0 {
		t.Fatalf("wrong answer scored %v", delta.Interaction.Score)
	}

	// Devoir bound to c1: grading bridges evidence into BKT.
	assignment := postJSON[core.Assignment](t, server, "/v1/tenants/"+tenant.ID+"/cohorts/"+cohort.ID+"/assignments", map[string]any{
		"title":      "Implémenter un handler POST",
		"domain_id":  graph.Domain.ID,
		"concept_id": "c1",
	}, http.StatusCreated)
	submission := postJSON[core.AssignmentSubmission](t, server, "/v1/tenants/"+tenant.ID+"/assignments/"+assignment.ID+"/submissions", map[string]any{
		"learner_id": "l1",
		"content":    "func create(w http.ResponseWriter, r *http.Request) { w.WriteHeader(201) }",
	}, http.StatusCreated)

	statesBefore := getJSON[[]core.LearnerState](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/state", http.StatusOK)
	graded := postJSON[map[string]any](t, server, "/v1/tenants/"+tenant.ID+"/submissions/"+submission.ID+"/grade", map[string]any{
		"score":    0.9,
		"feedback": "Très bon usage du status code.",
	}, http.StatusOK)
	sub, _ := graded["submission"].(map[string]any)
	if sub["score"] != 0.9 {
		t.Fatalf("grade not stored: %+v", graded)
	}
	if graded["state_delta"] == nil {
		t.Fatalf("manual grade did not bridge into the runtime: %+v", graded)
	}
	statesAfter := getJSON[[]core.LearnerState](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/state", http.StatusOK)
	if len(statesBefore) == 0 || len(statesAfter) == 0 || statesAfter[0].Mastery <= statesBefore[0].Mastery {
		t.Fatalf("mastery did not move after manual grade: before=%+v after=%+v", statesBefore, statesAfter)
	}

	// Graded submissions cannot be silently replaced.
	resp := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/tenants/"+tenant.ID+"/assignments/"+assignment.ID+"/submissions",
		jsonBody(map[string]any{"learner_id": "l1", "content": "v2"}))
	server.ServeHTTP(resp, req)
	if resp.Code != http.StatusConflict {
		t.Fatalf("resubmission after grading accepted: %d %s", resp.Code, resp.Body.String())
	}
}

// B-08/B-09: tenant legal profile + audit-ready Qualiopi bundle.
func TestTenantProfileAndQualiopiExport(t *testing.T) {
	server := newTestServer()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "Acme Formation", "slug": "acme"}, http.StatusCreated)
	program := postJSON[core.Program](t, server, "/v1/tenants/"+tenant.ID+"/programs", map[string]any{"name": "Go"}, http.StatusCreated)
	cohort := postJSON[core.Cohort](t, server, "/v1/tenants/"+tenant.ID+"/cohorts", map[string]any{"program_id": program.ID, "name": "June"}, http.StatusCreated)
	_ = postJSON[core.CohortEnrollment](t, server, "/v1/tenants/"+tenant.ID+"/cohorts/"+cohort.ID+"/enrollments", map[string]any{"learner_id": "l1"}, http.StatusCreated)

	// Legal profile round-trip.
	req := httptest.NewRequest(http.MethodPut, "/v1/tenants/"+tenant.ID+"/profile",
		jsonBody(map[string]any{"profile": map[string]any{"siret": "123 456 789 00012", "nda": "11 75 12345 75", "signataire": "S. Aalto, directrice"}}))
	resp := httptest.NewRecorder()
	server.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("update profile status=%d body=%s", resp.Code, resp.Body.String())
	}
	profile := getJSON[map[string]any](t, server, "/v1/tenants/"+tenant.ID+"/profile", http.StatusOK)
	p, _ := profile["profile"].(map[string]any)
	if p["siret"] != "123 456 789 00012" {
		t.Fatalf("profile not persisted: %+v", profile)
	}

	// Qualiopi bundle carries identity + progress + satisfaction + complaints.
	survey := postJSON[core.SatisfactionSurvey](t, server, "/v1/tenants/"+tenant.ID+"/cohorts/"+cohort.ID+"/surveys", map[string]any{
		"kind": "HOT", "title": "À chaud",
		"questions": []map[string]any{{"id": "q1", "prompt": "Note ?", "kind": "scale"}},
	}, http.StatusCreated)
	_ = postJSON[core.SurveyResponse](t, server, "/v1/tenants/"+tenant.ID+"/surveys/"+survey.ID+"/responses",
		map[string]any{"learner_id": "l1", "answers": map[string]any{"q1": 4}}, http.StatusCreated)
	_ = postJSON[core.Complaint](t, server, "/v1/tenants/"+tenant.ID+"/complaints", map[string]any{"subject": "Acoustique"}, http.StatusCreated)

	export := getJSON[map[string]any](t, server, "/v1/tenants/"+tenant.ID+"/cohorts/"+cohort.ID+"/qualiopi-export", http.StatusOK)
	org, _ := export["organisme"].(map[string]any)
	orgProfile, _ := org["profile"].(map[string]any)
	if orgProfile["nda"] != "11 75 12345 75" {
		t.Fatalf("export missing legal profile: %+v", export)
	}
	if export["progress"] == nil || export["satisfaction"] == nil || export["complaints"] == nil {
		t.Fatalf("export incomplete: %+v", export)
	}
	satisfaction, _ := export["satisfaction"].([]any)
	if len(satisfaction) != 1 {
		t.Fatalf("expected one survey summary: %+v", export["satisfaction"])
	}
	first, _ := satisfaction[0].(map[string]any)
	averages, _ := first["scale_averages"].(map[string]any)
	if averages["q1"] != float64(4) {
		t.Fatalf("scale average wrong: %+v", first)
	}
}

// B-11: satisfaction surveys + complaints register lifecycle.
func TestSatisfactionAndComplaints(t *testing.T) {
	server := newTestServer()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	program := postJSON[core.Program](t, server, "/v1/tenants/"+tenant.ID+"/programs", map[string]any{"name": "Go"}, http.StatusCreated)
	cohort := postJSON[core.Cohort](t, server, "/v1/tenants/"+tenant.ID+"/cohorts", map[string]any{"program_id": program.ID, "name": "June"}, http.StatusCreated)

	survey := postJSON[core.SatisfactionSurvey](t, server, "/v1/tenants/"+tenant.ID+"/cohorts/"+cohort.ID+"/surveys", map[string]any{
		"kind":  "HOT",
		"title": "À chaud — fin de formation",
		"questions": []map[string]any{
			{"id": "q1", "prompt": "Recommanderiez-vous cette formation ?", "kind": "scale"},
			{"id": "q2", "prompt": "Un commentaire ?", "kind": "text"},
		},
	}, http.StatusCreated)

	// Invalid rating is rejected; valid response accepted; duplicate refused.
	resp := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/tenants/"+tenant.ID+"/surveys/"+survey.ID+"/responses",
		jsonBody(map[string]any{"learner_id": "l1", "answers": map[string]any{"q1": 9}}))
	server.ServeHTTP(resp, req)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("out-of-range rating accepted: %d %s", resp.Code, resp.Body.String())
	}
	_ = postJSON[core.SurveyResponse](t, server, "/v1/tenants/"+tenant.ID+"/surveys/"+survey.ID+"/responses",
		map[string]any{"learner_id": "l1", "answers": map[string]any{"q1": 4, "q2": "Très clair."}}, http.StatusCreated)
	resp = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/v1/tenants/"+tenant.ID+"/surveys/"+survey.ID+"/responses",
		jsonBody(map[string]any{"learner_id": "l1", "answers": map[string]any{"q1": 5}}))
	server.ServeHTTP(resp, req)
	if resp.Code != http.StatusConflict {
		t.Fatalf("duplicate response accepted: %d %s", resp.Code, resp.Body.String())
	}
	responses := getJSON[[]core.SurveyResponse](t, server, "/v1/tenants/"+tenant.ID+"/surveys/"+survey.ID+"/responses", http.StatusOK)
	if len(responses) != 1 || responses[0].LearnerID != "l1" {
		t.Fatalf("unexpected responses: %+v", responses)
	}

	// Complaints: open → process → resolve, with the register listing it all.
	complaint := postJSON[core.Complaint](t, server, "/v1/tenants/"+tenant.ID+"/complaints", map[string]any{
		"opened_by": "l1",
		"subject":   "Salle inaccessible PMR",
	}, http.StatusCreated)
	if complaint.Status != "OPEN" {
		t.Fatalf("new complaint not OPEN: %+v", complaint)
	}
	resolved := patchJSON[core.Complaint](t, server, "/v1/tenants/"+tenant.ID+"/complaints/"+complaint.ID,
		map[string]any{"status": "RESOLVED", "resolution": "Changement de salle effectué."}, http.StatusOK)
	if resolved.Status != "RESOLVED" || resolved.ClosedAt == nil {
		t.Fatalf("complaint not resolved: %+v", resolved)
	}
	register := getJSON[[]core.Complaint](t, server, "/v1/tenants/"+tenant.ID+"/complaints", http.StatusOK)
	if len(register) != 1 {
		t.Fatalf("register should hold one complaint: %+v", register)
	}
}

// B-14: RGPD erasure removes every runtime trace of the learner.
func TestEraseLearnerData(t *testing.T) {
	server := newTestServer()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	graph := postJSON[core.DomainGraph](t, server, "/v1/tenants/"+tenant.ID+"/domains", map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{{"id": "c1", "name": "HTTP", "difficulty": 0.4}},
	}, http.StatusCreated)
	decision := postJSON[core.RuntimeDecision](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/activities/next", map[string]any{
		"domain_id": graph.Domain.ID,
	}, http.StatusCreated)
	_ = postJSON[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/assessments/"+decision.Activity.ID+"/submit", correctedAssessmentBody("l1", "c1"), http.StatusCreated)

	states := getJSON[[]core.LearnerState](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/state", http.StatusOK)
	if len(states) == 0 {
		t.Fatalf("expected learner state before erasure")
	}

	req := httptest.NewRequest(http.MethodDelete, "/v1/tenants/"+tenant.ID+"/learners/l1/data", nil)
	resp := httptest.NewRecorder()
	server.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("erase status=%d body=%s", resp.Code, resp.Body.String())
	}
	var erased struct {
		Erased map[string]int `json:"erased"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &erased); err != nil {
		t.Fatalf("decode erase response: %v", err)
	}
	for _, expected := range []string{"learner_states", "activities", "interactions", "pedagogical_snapshots"} {
		if erased.Erased[expected] == 0 {
			t.Fatalf("expected %s to be erased, got %+v", expected, erased.Erased)
		}
	}

	states = getJSON[[]core.LearnerState](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/state", http.StatusOK)
	if len(states) != 0 {
		t.Fatalf("learner states survived erasure: %+v", states)
	}
	snapshots := getJSON[[]core.PedagogicalSnapshot](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/snapshots", http.StatusOK)
	if len(snapshots) != 0 {
		t.Fatalf("snapshots survived erasure: %+v", snapshots)
	}
}

// B-25: planned sessions are exportable as an iCalendar feed.
func TestTrainingSessionsICSExport(t *testing.T) {
	server := newTestServer()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	program := postJSON[core.Program](t, server, "/v1/tenants/"+tenant.ID+"/programs", map[string]any{"name": "Go"}, http.StatusCreated)
	cohort := postJSON[core.Cohort](t, server, "/v1/tenants/"+tenant.ID+"/cohorts", map[string]any{"program_id": program.ID, "name": "June"}, http.StatusCreated)
	_ = postJSON[core.TrainingSession](t, server, "/v1/tenants/"+tenant.ID+"/training-sessions", map[string]any{
		"cohort_id": cohort.ID,
		"title":     "Atelier transactions; partie 1",
		"starts_at": "2026-06-20T09:00:00Z",
		"ends_at":   "2026-06-20T12:30:00Z",
		"video_url": "https://meet.example/abc",
	}, http.StatusCreated)

	req := httptest.NewRequest(http.MethodGet, "/v1/tenants/"+tenant.ID+"/training-sessions.ics?cohort_id="+cohort.ID, nil)
	resp := httptest.NewRecorder()
	server.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("ics status=%d body=%s", resp.Code, resp.Body.String())
	}
	if ct := resp.Header().Get("Content-Type"); !strings.Contains(ct, "text/calendar") {
		t.Fatalf("expected text/calendar, got %q", ct)
	}
	body := resp.Body.String()
	for _, needle := range []string{"BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART:20260620T090000Z", `SUMMARY:Atelier transactions\; partie 1`, "URL:https://meet.example/abc", "END:VCALENDAR"} {
		if !strings.Contains(body, needle) {
			t.Fatalf("ics missing %q in %q", needle, body)
		}
	}
}

// B-23: invite codes — admin creates, public looks up, trusted web tier redeems.
func TestCohortInviteLifecycle(t *testing.T) {
	server := newTestServerWithJWT()
	tenant := postJSONWithHeadersValue[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, bootstrapHeaders(), http.StatusCreated)
	program := postJSONWithHeadersValue[core.Program](t, server, "/v1/tenants/"+tenant.ID+"/programs", map[string]any{"name": "Go"}, bootstrapHeaders(), http.StatusCreated)
	cohort := postJSONWithHeadersValue[core.Cohort](t, server, "/v1/tenants/"+tenant.ID+"/cohorts", map[string]any{"program_id": program.ID, "name": "June"}, bootstrapHeaders(), http.StatusCreated)
	user := postJSONWithHeadersValue[core.User](t, server, "/v1/users", map[string]any{"email": "self@acme.test", "name": "Self Enroll"}, nil, http.StatusCreated)

	invite := postJSONWithHeadersValue[core.CohortInvite](t, server, "/v1/tenants/"+tenant.ID+"/cohorts/"+cohort.ID+"/invites", map[string]any{"max_uses": 1}, bootstrapHeaders(), http.StatusCreated)
	if invite.Code == "" || len(invite.Code) < 32 {
		t.Fatalf("invite code is not an unguessable secret: %q", invite.Code)
	}

	// Public lookup needs no auth and exposes only display data.
	lookup := getJSON[map[string]any](t, server, "/v1/invites/"+invite.Code, http.StatusOK)
	if lookup["usable"] != true || lookup["cohort_id"] != cohort.ID {
		t.Fatalf("unexpected lookup: %+v", lookup)
	}

	// Redemption without the bootstrap secret is refused.
	req := httptest.NewRequest(http.MethodPost, "/v1/invites/"+invite.Code+"/redeem", jsonBody(map[string]any{"user_id": user.ID}))
	resp := httptest.NewRecorder()
	server.ServeHTTP(resp, req)
	if resp.Code != http.StatusForbidden {
		t.Fatalf("redeem without bootstrap status=%d body=%s", resp.Code, resp.Body.String())
	}

	redeemed := postJSONWithHeadersValue[map[string]any](t, server, "/v1/invites/"+invite.Code+"/redeem", map[string]any{"user_id": user.ID}, bootstrapHeaders(), http.StatusCreated)
	if redeemed["cohort_id"] != cohort.ID {
		t.Fatalf("unexpected redemption: %+v", redeemed)
	}
	enrollments := getJSONWithHeaders[[]core.CohortEnrollment](t, server, "/v1/tenants/"+tenant.ID+"/cohorts/"+cohort.ID+"/enrollments", bootstrapHeaders(), http.StatusOK)
	if len(enrollments) != 1 || enrollments[0].LearnerID != user.ID {
		t.Fatalf("redemption did not enroll the learner: %+v", enrollments)
	}

	// max_uses=1 is exhausted: the next redemption fails and lookup says why.
	req = httptest.NewRequest(http.MethodPost, "/v1/invites/"+invite.Code+"/redeem", jsonBody(map[string]any{"user_id": user.ID}))
	for k, v := range bootstrapHeaders() {
		req.Header.Set(k, v)
	}
	resp = httptest.NewRecorder()
	server.ServeHTTP(resp, req)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("exhausted invite redeem status=%d body=%s", resp.Code, resp.Body.String())
	}
	lookup = getJSON[map[string]any](t, server, "/v1/invites/"+invite.Code, http.StatusOK)
	if lookup["usable"] != false {
		t.Fatalf("exhausted invite still reported usable: %+v", lookup)
	}

	// Revocation closes the door immediately.
	invite2 := postJSONWithHeadersValue[core.CohortInvite](t, server, "/v1/tenants/"+tenant.ID+"/cohorts/"+cohort.ID+"/invites", map[string]any{}, bootstrapHeaders(), http.StatusCreated)
	delReq := httptest.NewRequest(http.MethodDelete, "/v1/tenants/"+tenant.ID+"/invites/"+invite2.ID, nil)
	for k, v := range bootstrapHeaders() {
		delReq.Header.Set(k, v)
	}
	delResp := httptest.NewRecorder()
	server.ServeHTTP(delResp, delReq)
	if delResp.Code != http.StatusOK {
		t.Fatalf("revoke status=%d body=%s", delResp.Code, delResp.Body.String())
	}
	lookup = getJSON[map[string]any](t, server, "/v1/invites/"+invite2.Code, http.StatusOK)
	if lookup["usable"] != false || lookup["reason"] != "invitation révoquée" {
		t.Fatalf("revoked invite still usable: %+v", lookup)
	}
}

// B-24: editorial modules gate the adaptive runtime without replacing it.
func TestCourseModulesPathAndGating(t *testing.T) {
	server := newTestServer()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	graph := postJSON[core.DomainGraph](t, server, "/v1/tenants/"+tenant.ID+"/domains", map[string]any{
		"owner_id": "trainer",
		"name":     "Go",
		"source":   "TRAINER",
		"concepts": []map[string]any{
			{"id": "c1", "name": "HTTP", "difficulty": 0.4},
			{"id": "c2", "name": "Persistence", "difficulty": 0.6},
		},
		"dependencies": []map[string]any{{"parent_concept_id": "c1", "child_concept_id": "c2"}},
	}, http.StatusCreated)
	syllabus := postJSON[core.Syllabus](t, server, "/v1/tenants/"+tenant.ID+"/syllabi", map[string]any{
		"title": "Parcours Go",
	}, http.StatusCreated)

	// Module 1 completes after a single correct answer (low threshold on purpose).
	m1 := postJSON[core.CourseModule](t, server, "/v1/tenants/"+tenant.ID+"/syllabi/"+syllabus.ID+"/modules", map[string]any{
		"title":            "Démarrer",
		"position":         0,
		"concept_ids":      []string{"c1"},
		"required_mastery": 0.3,
	}, http.StatusCreated)
	m2 := postJSON[core.CourseModule](t, server, "/v1/tenants/"+tenant.ID+"/syllabi/"+syllabus.ID+"/modules", map[string]any{
		"title":            "Persister",
		"position":         1,
		"concept_ids":      []string{"c2"},
		"prerequisite_ids": []string{m1.ID},
	}, http.StatusCreated)
	if m2.RequiredMastery != 0.85 {
		t.Fatalf("default required_mastery=%v", m2.RequiredMastery)
	}

	// A prerequisite must exist and come earlier in the path.
	resp := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/tenants/"+tenant.ID+"/syllabi/"+syllabus.ID+"/modules",
		jsonBody(map[string]any{"title": "Bad", "position": 0, "prerequisite_ids": []string{m2.ID}}))
	server.ServeHTTP(resp, req)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid prerequisite to 400, got %d body=%s", resp.Code, resp.Body.String())
	}

	// Fresh learner: module 1 available, module 2 locked behind it.
	path := getJSON[[]core.ModuleProgress](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/path?syllabus_id="+syllabus.ID, http.StatusOK)
	if len(path) != 2 || path[0].Status != "AVAILABLE" || path[1].Status != "LOCKED" {
		t.Fatalf("unexpected fresh path: %+v", path)
	}

	// Gated planning only ever picks inside the unlocked module.
	decision := postJSON[core.RuntimeDecision](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/activities/next", map[string]any{
		"domain_id":           graph.Domain.ID,
		"allowed_concept_ids": []string{"c1"},
	}, http.StatusCreated)
	if decision.Activity.ConceptID != "c1" {
		t.Fatalf("gated planning escaped the unlocked module: %+v", decision.Activity)
	}
	_ = postJSON[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/assessments/"+decision.Activity.ID+"/submit", correctedAssessmentBody("l1", "c1"), http.StatusCreated)

	// Evidence flips module 1 to COMPLETED and unlocks module 2.
	path = getJSON[[]core.ModuleProgress](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/path?syllabus_id="+syllabus.ID, http.StatusOK)
	if path[0].Status != "COMPLETED" {
		t.Fatalf("module 1 not completed after correct evidence: %+v", path[0])
	}
	if path[1].Status != "AVAILABLE" {
		t.Fatalf("module 2 not unlocked: %+v", path[1])
	}

	// Update + archive round-trip.
	renamed := patchJSON[core.CourseModule](t, server, "/v1/tenants/"+tenant.ID+"/modules/"+m1.ID, map[string]any{"title": "Démarrer (v2)"}, http.StatusOK)
	if renamed.Title != "Démarrer (v2)" {
		t.Fatalf("module rename failed: %+v", renamed)
	}
	delReq := httptest.NewRequest(http.MethodDelete, "/v1/tenants/"+tenant.ID+"/modules/"+m2.ID, nil)
	delResp := httptest.NewRecorder()
	server.ServeHTTP(delResp, delReq)
	if delResp.Code != http.StatusOK {
		t.Fatalf("archive module status=%d body=%s", delResp.Code, delResp.Body.String())
	}
	modules := getJSON[[]core.CourseModule](t, server, "/v1/tenants/"+tenant.ID+"/syllabi/"+syllabus.ID+"/modules", http.StatusOK)
	if len(modules) != 1 || modules[0].ID != m1.ID {
		t.Fatalf("archived module still listed: %+v", modules)
	}
}

func correctedAssessmentBody(learnerID, choiceID string) map[string]any {
	return map[string]any{
		"learner_id": learnerID,
		"answers": []map[string]any{
			{"item_id": "concept-check", "choice_id": choiceID},
		},
	}
}

func postJSON[T any](t *testing.T, server http.Handler, path string, body any, wantStatus int) T {
	t.Helper()
	decoded, _ := postJSONWithHeaders[T](t, server, path, body, nil, wantStatus)
	return decoded
}

func postJSONWithHeaders[T any](t *testing.T, server http.Handler, path string, body any, headers map[string]string, wantStatus int) (T, *httptest.ResponseRecorder) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, jsonBody(body))
	req.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp := httptest.NewRecorder()
	server.ServeHTTP(resp, req)
	if resp.Code != wantStatus {
		t.Fatalf("POST %s status=%d want=%d body=%s", path, resp.Code, wantStatus, resp.Body.String())
	}
	var decoded T
	if err := json.Unmarshal(resp.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode response: %v body=%s", err, resp.Body.String())
	}
	return decoded, resp
}

func postJSONWithHeadersValue[T any](t *testing.T, server http.Handler, path string, body any, headers map[string]string, wantStatus int) T {
	t.Helper()
	decoded, _ := postJSONWithHeaders[T](t, server, path, body, headers, wantStatus)
	return decoded
}

func patchJSON[T any](t *testing.T, server http.Handler, path string, body any, wantStatus int) T {
	t.Helper()
	req := httptest.NewRequest(http.MethodPatch, path, jsonBody(body))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	server.ServeHTTP(resp, req)
	if resp.Code != wantStatus {
		t.Fatalf("PATCH %s status=%d want=%d body=%s", path, resp.Code, wantStatus, resp.Body.String())
	}
	var decoded T
	if err := json.Unmarshal(resp.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode response: %v body=%s", err, resp.Body.String())
	}
	return decoded
}

func putJSON[T any](t *testing.T, server http.Handler, path string, body any, wantStatus int) T {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, path, jsonBody(body))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	server.ServeHTTP(resp, req)
	if resp.Code != wantStatus {
		t.Fatalf("PUT %s status=%d want=%d body=%s", path, resp.Code, wantStatus, resp.Body.String())
	}
	var decoded T
	if err := json.Unmarshal(resp.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode response: %v body=%s", err, resp.Body.String())
	}
	return decoded
}

func getJSON[T any](t *testing.T, server http.Handler, path string, wantStatus int) T {
	t.Helper()
	return getJSONWithHeaders[T](t, server, path, nil, wantStatus)
}

func assertGETBody(t *testing.T, server http.Handler, path string, headers map[string]string, wantStatus int, wantBody string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp := httptest.NewRecorder()
	server.ServeHTTP(resp, req)
	if resp.Code != wantStatus {
		t.Fatalf("GET %s status=%d want=%d body=%s", path, resp.Code, wantStatus, resp.Body.String())
	}
	if got := strings.TrimSpace(resp.Body.String()); got != wantBody {
		t.Fatalf("GET %s body=%q want %q", path, got, wantBody)
	}
}

func getJSONWithHeaders[T any](t *testing.T, server http.Handler, path string, headers map[string]string, wantStatus int) T {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp := httptest.NewRecorder()
	server.ServeHTTP(resp, req)
	if resp.Code != wantStatus {
		t.Fatalf("GET %s status=%d want=%d body=%s", path, resp.Code, wantStatus, resp.Body.String())
	}
	var decoded T
	if err := json.Unmarshal(resp.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode response: %v body=%s", err, resp.Body.String())
	}
	return decoded
}

func expectJSONStatus(t *testing.T, server http.Handler, method, path string, body any, headers map[string]string, wantStatus int) {
	t.Helper()
	req := httptest.NewRequest(method, path, jsonBody(body))
	req.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp := httptest.NewRecorder()
	server.ServeHTTP(resp, req)
	if resp.Code != wantStatus {
		t.Fatalf("%s %s status=%d want=%d body=%s", method, path, resp.Code, wantStatus, resp.Body.String())
	}
}

func bearerHeaders(token string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + token}
}

func findAlert(t *testing.T, alerts []core.Alert, alertType string) core.Alert {
	t.Helper()
	for _, alert := range alerts {
		if alert.AlertType == alertType {
			return alert
		}
	}
	t.Fatalf("missing alert %s in %+v", alertType, alerts)
	return core.Alert{}
}

func countEvents(events []core.Event, eventType, alertType string) int {
	count := 0
	for _, event := range events {
		if event.EventType != eventType {
			continue
		}
		if got, ok := event.Payload["alert_type"].(string); ok && got == alertType {
			count++
		}
	}
	return count
}

func countEventType(events []core.Event, eventType string) int {
	count := 0
	for _, event := range events {
		if event.EventType == eventType {
			count++
		}
	}
	return count
}

func jsonBody(v any) *bytes.Reader {
	data, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return bytes.NewReader(data)
}

// B-10: contractual documents — create, version, learner-scoped reads.
func TestOFDocuments(t *testing.T) {
	server := newTestServer()
	tenant := postJSON[core.Tenant](t, server, "/v1/tenants", map[string]any{"name": "A", "slug": "a"}, http.StatusCreated)
	doc := postJSON[core.OFDocument](t, server, "/v1/tenants/"+tenant.ID+"/documents", map[string]any{
		"kind":  "REGLEMENT_INTERIEUR",
		"title": "Règlement intérieur",
		"body":  "Article 1 — …",
	}, http.StatusCreated)
	if doc.Version != 1 || doc.RootID != doc.ID {
		t.Fatalf("unexpected first version: %+v", doc)
	}
	v2 := postJSON[core.OFDocument](t, server, "/v1/tenants/"+tenant.ID+"/documents/"+doc.ID+"/versions", map[string]any{
		"body": "Article 1 — révisé.",
	}, http.StatusCreated)
	if v2.Version != 2 || v2.RootID != doc.ID || v2.Title != doc.Title {
		t.Fatalf("unexpected version 2: %+v", v2)
	}
	documents := getJSON[[]core.OFDocument](t, server, "/v1/tenants/"+tenant.ID+"/documents", http.StatusOK)
	if len(documents) != 1 || documents[0].Version != 2 {
		t.Fatalf("list should return only the latest version: %+v", documents)
	}
}
