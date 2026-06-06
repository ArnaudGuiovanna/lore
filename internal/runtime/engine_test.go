package runtime_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"lore/internal/core"
	"lore/internal/runtime"
	"lore/internal/store"
)

func TestPlanNextIsDeterministicForSameSnapshot(t *testing.T) {
	ctx := context.Background()
	mem, tenantID, domainID := runtimeFixture(t)
	engine := runtime.NewEngine(mem).WithClock(func() time.Time {
		return time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	})

	first, err := engine.PlanNext(ctx, runtime.PlanNextInput{TenantID: tenantID, LearnerID: "learner-1", DomainID: domainID})
	if err != nil {
		t.Fatalf("plan first: %v", err)
	}
	if first.Activity.ActivityType != core.ActivityAssessment {
		t.Fatalf("first activity should be diagnostic assessment, got %s", first.Activity.ActivityType)
	}
	if first.TutorInstruction.Context["phase"] != core.PhaseDiagnostic {
		t.Fatalf("first plan should be diagnostic phase, got %+v", first.TutorInstruction.Context["phase"])
	}
	for i := 0; i < 100; i++ {
		next, err := engine.PlanNext(ctx, runtime.PlanNextInput{TenantID: tenantID, LearnerID: "learner-1", DomainID: domainID})
		if err != nil {
			t.Fatalf("plan %d: %v", i, err)
		}
		if next.Activity.ConceptID != first.Activity.ConceptID {
			t.Fatalf("concept drifted: got %s want %s", next.Activity.ConceptID, first.Activity.ConceptID)
		}
		if next.Activity.ActivityType != first.Activity.ActivityType {
			t.Fatalf("activity drifted: got %s want %s", next.Activity.ActivityType, first.Activity.ActivityType)
		}
		if next.Activity.AuditRationale != first.Activity.AuditRationale {
			t.Fatalf("rationale drifted: got %q want %q", next.Activity.AuditRationale, first.Activity.AuditRationale)
		}
	}
}

func TestRecordInteractionUpdatesStateAndRejectsInvalidScore(t *testing.T) {
	ctx := context.Background()
	mem, tenantID, domainID := runtimeFixture(t)
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	engine := runtime.NewEngine(mem).WithClock(func() time.Time { return now })

	decision, err := engine.PlanNext(ctx, runtime.PlanNextInput{TenantID: tenantID, LearnerID: "learner-1", DomainID: domainID})
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	_, err = engine.RecordInteraction(ctx, core.InteractionCommand{
		TenantID:   tenantID,
		LearnerID:  "learner-1",
		ActivityID: decision.Activity.ID,
		Score:      1.2,
		Success:    true,
	})
	if !errors.Is(err, core.ErrInvalidInput) {
		t.Fatalf("invalid score should be rejected, got %v", err)
	}

	delta, err := engine.RecordInteraction(ctx, core.InteractionCommand{
		TenantID:   tenantID,
		LearnerID:  "learner-1",
		ActivityID: decision.Activity.ID,
		Score:      0.92,
		Success:    true,
		Feedback:   "clear evidence",
	})
	if err != nil {
		t.Fatalf("record interaction: %v", err)
	}
	if delta.After.Mastery <= delta.Before.Mastery {
		t.Fatalf("mastery did not increase: before=%f after=%f", delta.Before.Mastery, delta.After.Mastery)
	}
	if delta.After.DueAt == nil || !delta.After.DueAt.After(now) {
		t.Fatalf("expected future review due date, got %v", delta.After.DueAt)
	}
	states, err := engine.GetLearnerModel(ctx, tenantID, "learner-1")
	if err != nil {
		t.Fatalf("learner model: %v", err)
	}
	if len(states) != 1 {
		t.Fatalf("expected one learner state, got %d", len(states))
	}
	if states[0].TenantID != tenantID {
		t.Fatalf("state tenant leaked: got %s want %s", states[0].TenantID, tenantID)
	}
}

func TestRecordInteractionEmitsReviewAndMisconceptionEvents(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	mem := store.NewMemoryStore()
	tenant, err := mem.CreateTenant(ctx, "Acme", "acme", "")
	if err != nil {
		t.Fatalf("tenant: %v", err)
	}
	// Single-concept domain so concept selection is unambiguous across plans.
	graph, err := mem.CreateDomain(ctx, tenant.ID, "trainer-1", "Go", "", "TRAINER",
		[]core.ConceptDraft{{ID: "concept-a", Name: "HTTP", Difficulty: 0.4}}, nil)
	if err != nil {
		t.Fatalf("domain: %v", err)
	}
	engine := runtime.NewEngine(mem).WithClock(func() time.Time { return now })

	// Failed interaction with an error type → MisconceptionDetected, no resolution yet.
	d1, err := engine.PlanNext(ctx, runtime.PlanNextInput{TenantID: tenant.ID, LearnerID: "l1", DomainID: graph.Domain.ID})
	if err != nil {
		t.Fatalf("plan 1: %v", err)
	}
	delta1, err := engine.RecordInteraction(ctx, core.InteractionCommand{
		TenantID: tenant.ID, LearnerID: "l1", ActivityID: d1.Activity.ID, Success: false, Score: 0.1, ErrorType: "off_by_one",
	})
	if err != nil {
		t.Fatalf("record 1: %v", err)
	}
	types1 := eventTypes(delta1.Events)
	if !types1["MisconceptionDetected"] {
		t.Fatalf("expected MisconceptionDetected after failed interaction, got %v", types1)
	}
	if types1["MisconceptionResolved"] {
		t.Fatalf("did not expect MisconceptionResolved on first failure, got %v", types1)
	}

	// Successful follow-up on the now-due, previously-lapsed concept →
	// ReviewCompleted + MisconceptionResolved.
	d2, err := engine.PlanNext(ctx, runtime.PlanNextInput{TenantID: tenant.ID, LearnerID: "l1", DomainID: graph.Domain.ID})
	if err != nil {
		t.Fatalf("plan 2: %v", err)
	}
	delta2, err := engine.RecordInteraction(ctx, core.InteractionCommand{
		TenantID: tenant.ID, LearnerID: "l1", ActivityID: d2.Activity.ID, Success: true, Score: 0.95,
	})
	if err != nil {
		t.Fatalf("record 2: %v", err)
	}
	types2 := eventTypes(delta2.Events)
	if !types2["ReviewCompleted"] {
		t.Fatalf("expected ReviewCompleted on due review, got %v", types2)
	}
	if !types2["MisconceptionResolved"] {
		t.Fatalf("expected MisconceptionResolved after correcting a lapsed concept, got %v", types2)
	}
}

func eventTypes(events []core.Event) map[string]bool {
	out := map[string]bool{}
	for _, e := range events {
		out[e.EventType] = true
	}
	return out
}

func runtimeFixture(t *testing.T) (*store.MemoryStore, string, string) {
	t.Helper()
	ctx := context.Background()
	mem := store.NewMemoryStore()
	tenant, err := mem.CreateTenant(ctx, "Acme", "acme", "")
	if err != nil {
		t.Fatalf("tenant: %v", err)
	}
	graph, err := mem.CreateDomain(ctx, tenant.ID, "trainer-1", "Go Backend", "Backend fundamentals", "TRAINER", []core.ConceptDraft{
		{ID: "concept-a", Name: "HTTP handlers", Difficulty: 0.4},
		{ID: "concept-b", Name: "Persistence", Difficulty: 0.7},
	}, []core.DependencyDraft{
		{ParentConceptID: "concept-a", ChildConceptID: "concept-b"},
	})
	if err != nil {
		t.Fatalf("domain: %v", err)
	}
	return mem, tenant.ID, graph.Domain.ID
}
