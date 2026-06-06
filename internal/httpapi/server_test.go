package httpapi_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

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

	delta := postJSON[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/interactions", map[string]any{
		"learner_id":  "l1",
		"activity_id": decision.Activity.ID,
		"success":     true,
		"score":       0.88,
	}, http.StatusCreated)
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
	for _, eventType := range []string{"DomainCreated", "ActivityPlanned", "ActivityStarted", "GeneratedContentCreated", "ActivityCompleted", "InteractionRecorded"} {
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
	_ = postJSON[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/interactions", map[string]any{
		"learner_id":  "l1",
		"activity_id": decision.Activity.ID,
		"success":     false,
		"score":       0.20,
	}, http.StatusCreated)

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
		"success":    true,
		"score":      0.91,
	}, http.StatusCreated)
	if delta.Evaluation.Rubric["activity_type"] != string(core.ActivityAssessment) {
		t.Fatalf("assessment rubric did not preserve runtime activity type: %+v", delta.Evaluation.Rubric)
	}
	if delta.After.Mastery <= delta.Before.Mastery {
		t.Fatalf("assessment evidence did not update mastery")
	}
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
	body := map[string]any{
		"learner_id":  "l1",
		"activity_id": decision.Activity.ID,
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
	if len(states) != 1 || states[0].Reps != 1 {
		t.Fatalf("idempotent replay reapplied learner state: %+v", states)
	}

	second, _ := postJSONWithHeaders[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/interactions", body, map[string]string{
		"Idempotency-Key": "interaction-retry-2",
	}, http.StatusCreated)
	if second.Interaction.ID == first.Interaction.ID {
		t.Fatalf("different idempotency key should create a new interaction")
	}
	states = getJSON[[]core.LearnerState](t, server, "/v1/tenants/"+tenant.ID+"/learners/l1/state", http.StatusOK)
	if len(states) != 1 || states[0].Reps != 2 {
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
		"success":    true,
		"score":      0.91,
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
	for range 3 {
		_ = postJSON[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/interactions", map[string]any{
			"learner_id":  "l1",
			"activity_id": decision.Activity.ID,
			"success":     false,
			"score":       0.10,
		}, http.StatusCreated)
	}

	alerts := getJSON[[]core.Alert](t, server, "/v1/tenants/"+tenant.ID+"/alerts", http.StatusOK)
	risk := findAlert(t, alerts, "LearnerAtRisk")
	if risk.Status != "OPEN" || risk.ID == "" || risk.RecommendedAction == "" {
		t.Fatalf("unexpected durable alert: %+v", risk)
	}
	alerts = getJSON[[]core.Alert](t, server, "/v1/tenants/"+tenant.ID+"/alerts", http.StatusOK)
	replayedRisk := findAlert(t, alerts, "LearnerAtRisk")
	if replayedRisk.ID != risk.ID {
		t.Fatalf("durable alert was not deduplicated: first=%s second=%s", risk.ID, replayedRisk.ID)
	}
	events := getJSON[[]core.Event](t, server, "/v1/tenants/"+tenant.ID+"/events/outbox?published=false", http.StatusOK)
	if countEvents(events, "AlertRaised", "LearnerAtRisk") != 1 {
		t.Fatalf("expected one AlertRaised event for LearnerAtRisk, got events=%+v", events)
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
	expectJSONStatus(t, server, http.MethodPost, "/v1/tenants/"+tenant.ID+"/interactions", map[string]any{
		"learner_id":  "other-learner",
		"activity_id": decision.Activity.ID,
		"success":     true,
		"score":       0.9,
	}, bearerHeaders(learnerToken), http.StatusForbidden)

	_ = postJSON[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/interactions", map[string]any{
		"learner_id":  learner.ID,
		"activity_id": decision.Activity.ID,
		"success":     true,
		"score":       0.9,
	}, http.StatusUnauthorized)
	_, _ = postJSONWithHeaders[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/interactions", map[string]any{
		"learner_id":  learner.ID,
		"activity_id": decision.Activity.ID,
		"success":     true,
		"score":       0.9,
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

	_ = postJSON[core.StateDelta](t, server, "/v1/tenants/"+tenant.ID+"/interactions", map[string]any{
		"learner_id":  "l1",
		"activity_id": decision.Activity.ID,
		"success":     true,
		"score":       0.9,
	}, http.StatusCreated)
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

func jsonBody(v any) *bytes.Reader {
	data, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return bytes.NewReader(data)
}
