package runtime_test

import (
	"context"
	"errors"
	"strings"
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

func TestSubmitAssessmentUsesCorrectedEvidenceForMastery(t *testing.T) {
	ctx := context.Background()
	mem, tenantID, domainID := runtimeFixture(t)
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	engine := runtime.NewEngine(mem).WithClock(func() time.Time { return now })
	decision, err := engine.PlanNext(ctx, runtime.PlanNextInput{TenantID: tenantID, LearnerID: "learner-1", DomainID: domainID, Intent: "assessment"})
	if err != nil {
		t.Fatalf("plan assessment: %v", err)
	}
	selfSuccess := true
	selfScore := 1.0
	confidence := 1.0

	delta, err := engine.SubmitAssessment(ctx, core.AssessmentSubmissionCommand{
		TenantID:            tenantID,
		LearnerID:           "learner-1",
		ActivityID:          decision.Activity.ID,
		SelfReportedSuccess: &selfSuccess,
		SelfReportedScore:   &selfScore,
		Confidence:          &confidence,
		Answers: []core.AssessmentAnswer{
			{ItemID: "concept-check", ChoiceID: "not_sure"},
		},
	})
	if err != nil {
		t.Fatalf("submit assessment: %v", err)
	}
	if delta.Interaction.Score != 0 || delta.Evaluation.Score != 0 || delta.Interaction.Success {
		t.Fatalf("corrected score should override self-report, got interaction=%+v evaluation=%+v", delta.Interaction, delta.Evaluation)
	}
	if delta.Evaluation.Rubric["score_source"] != "runtime_correction" {
		t.Fatalf("missing runtime correction evidence in rubric: %+v", delta.Evaluation.Rubric)
	}
	expected := runtime.ApplyReviewSchedule(runtime.BKTUpdate(delta.Before, false), false, 0, now)
	if delta.After.Mastery != expected.Mastery || delta.After.Reps != expected.Reps {
		t.Fatalf("mastery was not fed by corrected failure: got after=%+v want=%+v", delta.After, expected)
	}
}

func TestPlanNextEscapesOverloadAfterConsecutiveFailures(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	mem := store.NewMemoryStore()
	tenant, err := mem.CreateTenant(ctx, "Acme", "acme", "")
	if err != nil {
		t.Fatalf("tenant: %v", err)
	}
	graph, err := mem.CreateDomain(ctx, tenant.ID, "trainer-1", "Go", "", "TRAINER",
		[]core.ConceptDraft{{ID: "concept-a", Name: "HTTP", Difficulty: 0.4}}, nil)
	if err != nil {
		t.Fatalf("domain: %v", err)
	}
	engine := runtime.NewEngine(mem).WithClock(func() time.Time { return now })
	decision, err := engine.PlanNext(ctx, runtime.PlanNextInput{TenantID: tenant.ID, LearnerID: "l1", DomainID: graph.Domain.ID})
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	for i := 0; i < 3; i++ {
		if _, err := engine.RecordInteraction(ctx, core.InteractionCommand{
			TenantID: tenant.ID, LearnerID: "l1", ActivityID: decision.Activity.ID, Success: false, Score: 0.10,
		}); err != nil {
			t.Fatalf("record failed interaction %d: %v", i, err)
		}
	}

	recovery, err := engine.PlanNext(ctx, runtime.PlanNextInput{TenantID: tenant.ID, LearnerID: "l1", DomainID: graph.Domain.ID})
	if err != nil {
		t.Fatalf("recovery plan: %v", err)
	}
	if recovery.Activity.ActivityType != core.ActivityRest {
		t.Fatalf("expected overload recovery activity, got %s", recovery.Activity.ActivityType)
	}
	if !strings.Contains(recovery.Activity.AuditRationale, "overload escape") {
		t.Fatalf("expected overload rationale, got %q", recovery.Activity.AuditRationale)
	}
}

func TestPlanNextAppliesAntiRepeatDuringInstruction(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	mem := store.NewMemoryStore()
	tenant, err := mem.CreateTenant(ctx, "Acme", "acme", "")
	if err != nil {
		t.Fatalf("tenant: %v", err)
	}
	graph, err := mem.CreateDomain(ctx, tenant.ID, "trainer-1", "Go", "", "TRAINER", []core.ConceptDraft{
		{ID: "c1", Name: "A", Difficulty: 0.5},
		{ID: "c2", Name: "B", Difficulty: 0.5},
		{ID: "c3", Name: "C", Difficulty: 0.5},
		{ID: "c4", Name: "D", Difficulty: 0.5},
	}, nil)
	if err != nil {
		t.Fatalf("domain: %v", err)
	}
	engine := runtime.NewEngine(mem).WithClock(func() time.Time { return now })
	for _, wantConcept := range []string{"c1", "c2", "c3", "c4"} {
		decision, err := engine.PlanNext(ctx, runtime.PlanNextInput{TenantID: tenant.ID, LearnerID: "l1", DomainID: graph.Domain.ID})
		if err != nil {
			t.Fatalf("plan diagnostic for %s: %v", wantConcept, err)
		}
		if decision.Activity.ConceptID != wantConcept {
			t.Fatalf("diagnostic order drifted: got %s want %s", decision.Activity.ConceptID, wantConcept)
		}
		if _, err := engine.RecordInteraction(ctx, core.InteractionCommand{
			TenantID: tenant.ID, LearnerID: "l1", ActivityID: decision.Activity.ID, Success: true, Score: 0.80,
		}); err != nil {
			t.Fatalf("record diagnostic for %s: %v", wantConcept, err)
		}
		now = now.Add(time.Minute)
	}

	next, err := engine.PlanNext(ctx, runtime.PlanNextInput{TenantID: tenant.ID, LearnerID: "l1", DomainID: graph.Domain.ID})
	if err != nil {
		t.Fatalf("plan instruction: %v", err)
	}
	if next.TutorInstruction.Context["phase"] != core.PhaseInstruction {
		t.Fatalf("expected instruction phase, got %+v", next.TutorInstruction.Context["phase"])
	}
	if next.Activity.ConceptID != "c1" {
		t.Fatalf("expected anti-repeat to select oldest non-recent concept c1, got %s (%s)", next.Activity.ConceptID, next.Activity.AuditRationale)
	}
	if strings.Contains(next.Activity.AuditRationale, "anti-repeat penalty") {
		t.Fatalf("selected concept should not have been recently penalized: %s", next.Activity.AuditRationale)
	}
}

func TestComputeAlertsDetectsPlateauZPDDriftAndOverload(t *testing.T) {
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	alerts := runtime.ComputeAlerts([]core.LearnerState{
		{
			TenantID: "tenant", LearnerID: "l1", DomainID: "domain", ConceptID: "plateau",
			Mastery: 0.40, Reps: 4, CardState: core.ReviewReview, Stability: 4, Difficulty: 5,
		},
		{
			TenantID: "tenant", LearnerID: "l1", DomainID: "domain", ConceptID: "zpd",
			Mastery: 0.70, Reps: 2, CardState: core.ReviewReview, Stability: 4, Ability: -1, Difficulty: 8,
		},
	}, []core.Interaction{
		{TenantID: "tenant", LearnerID: "l1", ConceptID: "plateau", Success: false, CreatedAt: now},
		{TenantID: "tenant", LearnerID: "l1", ConceptID: "plateau", Success: false, CreatedAt: now.Add(-time.Minute)},
		{TenantID: "tenant", LearnerID: "l1", ConceptID: "plateau", Success: false, CreatedAt: now.Add(-2 * time.Minute)},
	}, now)
	types := alertTypes(alerts)
	for _, want := range []string{"Plateau", "ZPDDrift", "Overload"} {
		if !types[want] {
			t.Fatalf("missing alert %s in %+v", want, alerts)
		}
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
	if len(delta1.Misconceptions) != 1 || delta1.Misconceptions[0].Status != "ACTIVE" {
		t.Fatalf("expected one active misconception change, got %+v", delta1.Misconceptions)
	}
	active, err := mem.ListActiveMisconceptions(ctx, tenant.ID, "l1", graph.Domain.ID)
	if err != nil {
		t.Fatalf("list active misconceptions: %v", err)
	}
	if len(active) != 1 || active[0].Description != "off_by_one" {
		t.Fatalf("active misconception not persisted: %+v", active)
	}

	// Successful follow-up on the now-due, previously-lapsed concept →
	// ReviewCompleted + MisconceptionResolved.
	d2, err := engine.PlanNext(ctx, runtime.PlanNextInput{TenantID: tenant.ID, LearnerID: "l1", DomainID: graph.Domain.ID})
	if err != nil {
		t.Fatalf("plan 2: %v", err)
	}
	if d2.Activity.ActivityType != core.ActivityMisconception {
		t.Fatalf("expected active misconception to be planned before review, got %s", d2.Activity.ActivityType)
	}
	if got := d2.TutorInstruction.Context["misconception"]; got == nil {
		t.Fatalf("misconception context missing from tutor instruction: %+v", d2.TutorInstruction.Context)
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
	active, err = mem.ListActiveMisconceptions(ctx, tenant.ID, "l1", graph.Domain.ID)
	if err != nil {
		t.Fatalf("list active misconceptions after resolution: %v", err)
	}
	if len(active) != 0 {
		t.Fatalf("misconception should have been resolved, still active: %+v", active)
	}
}

func eventTypes(events []core.Event) map[string]bool {
	out := map[string]bool{}
	for _, e := range events {
		out[e.EventType] = true
	}
	return out
}

func alertTypes(alerts []core.Alert) map[string]bool {
	out := map[string]bool{}
	for _, alert := range alerts {
		out[alert.AlertType] = true
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
