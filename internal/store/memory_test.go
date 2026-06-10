package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"lore/internal/core"
	"lore/internal/runtime"
	"lore/internal/store"
)

func TestMemoryStoreRejectsUnknownMembershipRole(t *testing.T) {
	ctx := context.Background()
	mem := store.NewMemoryStore()
	tenant, err := mem.CreateTenant(ctx, "Acme", "acme", "")
	if err != nil {
		t.Fatalf("tenant: %v", err)
	}
	user, err := mem.CreateUser(ctx, "u@example.test", "U")
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	if _, err := mem.AddMembership(ctx, tenant.ID, user.ID, core.Role("WIZARD")); !errors.Is(err, core.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for unknown role, got %v", err)
	}
	// An empty role defaults to LEARNER rather than being rejected.
	membership, err := mem.AddMembership(ctx, tenant.ID, user.ID, "")
	if err != nil {
		t.Fatalf("default role membership: %v", err)
	}
	if membership.Role != core.RoleLearner {
		t.Fatalf("empty role should default to LEARNER, got %s", membership.Role)
	}
}

func TestMemoryStoreScopesMembershipsByTenant(t *testing.T) {
	ctx := context.Background()
	mem := store.NewMemoryStore()
	tenantA, _ := mem.CreateTenant(ctx, "Alpha", "alpha", "")
	tenantB, _ := mem.CreateTenant(ctx, "Beta", "beta", "")
	userA, _ := mem.CreateUser(ctx, "a@example.test", "A")
	userB, _ := mem.CreateUser(ctx, "b@example.test", "B")
	if _, err := mem.AddMembership(ctx, tenantA.ID, userA.ID, core.RoleTrainer); err != nil {
		t.Fatalf("membership a: %v", err)
	}
	if _, err := mem.AddMembership(ctx, tenantB.ID, userB.ID, core.RoleTrainer); err != nil {
		t.Fatalf("membership b: %v", err)
	}

	got, err := mem.ListMemberships(ctx, tenantA.ID)
	if err != nil {
		t.Fatalf("list memberships: %v", err)
	}
	if len(got) != 1 || got[0].UserID != userA.ID {
		t.Fatalf("tenant A memberships leaked across tenants: %+v", got)
	}
}

func TestMemoryAdminCRUDSessionsAndAuditAreTenantScoped(t *testing.T) {
	ctx := context.Background()
	mem := store.NewMemoryStore()
	tenantA, _ := mem.CreateTenant(ctx, "Alpha", "alpha", "")
	tenantB, _ := mem.CreateTenant(ctx, "Beta", "beta", "")
	learner, _ := mem.CreateUser(ctx, "learner@example.test", "Learner")
	if _, err := mem.AddMembership(ctx, tenantA.ID, learner.ID, core.RoleLearner, "admin-a"); err != nil {
		t.Fatalf("membership: %v", err)
	}

	programA, err := mem.CreateProgram(ctx, tenantA.ID, "Go Backend", "admin-a")
	if err != nil {
		t.Fatalf("program a: %v", err)
	}
	programB, err := mem.CreateProgram(ctx, tenantB.ID, "Rust Backend", "admin-b")
	if err != nil {
		t.Fatalf("program b: %v", err)
	}
	if _, err := mem.UpdateProgram(ctx, tenantA.ID, programB.ID, "Leak", "", "admin-a"); !errors.Is(err, core.ErrNotFound) {
		t.Fatalf("cross-tenant program update should be not found, got %v", err)
	}
	programA, err = mem.UpdateProgram(ctx, tenantA.ID, programA.ID, "Go Backend Advanced", "ACTIVE", "admin-a")
	if err != nil {
		t.Fatalf("update program: %v", err)
	}
	if programA.Name != "Go Backend Advanced" || programA.UpdatedAt.IsZero() {
		t.Fatalf("program not updated: %+v", programA)
	}

	cohort, err := mem.CreateCohort(ctx, tenantA.ID, programA.ID, "June", time.Time{}, time.Time{}, "admin-a")
	if err != nil {
		t.Fatalf("cohort: %v", err)
	}
	enrollment, err := mem.EnrollLearner(ctx, tenantA.ID, cohort.ID, learner.ID, "admin-a")
	if err != nil {
		t.Fatalf("enroll: %v", err)
	}
	enrollment, err = mem.UpdateCohortEnrollmentStatus(ctx, tenantA.ID, cohort.ID, learner.ID, "COMPLETED", "admin-a")
	if err != nil {
		t.Fatalf("update enrollment: %v", err)
	}
	if enrollment.Status != "COMPLETED" {
		t.Fatalf("enrollment status=%s", enrollment.Status)
	}

	startsAt := time.Date(2026, 6, 10, 9, 0, 0, 0, time.UTC)
	session, err := mem.CreateTrainingSession(ctx, core.TrainingSession{
		TenantID: tenantA.ID,
		CohortID: cohort.ID,
		Title:    "Seance 1",
		StartsAt: startsAt,
		EndsAt:   startsAt.Add(2 * time.Hour),
		Capacity: 12,
		Location: "Lyon",
		VideoURL: "https://video.example.test/s1",
	}, "admin-a")
	if err != nil {
		t.Fatalf("session: %v", err)
	}
	if session.ProgramID != programA.ID || session.Status != "SCHEDULED" {
		t.Fatalf("session did not derive program/status: %+v", session)
	}
	newCapacity := 10
	session, err = mem.UpdateTrainingSession(ctx, tenantA.ID, session.ID, core.TrainingSessionPatch{Capacity: &newCapacity}, "admin-a")
	if err != nil {
		t.Fatalf("update session: %v", err)
	}
	if session.Capacity != 10 {
		t.Fatalf("session capacity not updated: %+v", session)
	}
	archivedSession, err := mem.ArchiveTrainingSession(ctx, tenantA.ID, session.ID, "admin-a")
	if err != nil {
		t.Fatalf("archive session: %v", err)
	}
	if archivedSession.Status != "ARCHIVED" || archivedSession.ArchivedAt == nil {
		t.Fatalf("session not archived: %+v", archivedSession)
	}

	updatedUser, err := mem.UpdateTenantUser(ctx, tenantA.ID, learner.ID, "learner2@example.test", "Learner Two", "ACTIVE", "admin-a")
	if err != nil {
		t.Fatalf("update tenant user: %v", err)
	}
	if updatedUser.Email != "learner2@example.test" || updatedUser.Role != core.RoleLearner {
		t.Fatalf("unexpected tenant user: %+v", updatedUser)
	}
	archivedUser, err := mem.ArchiveTenantUser(ctx, tenantA.ID, learner.ID, "admin-a")
	if err != nil {
		t.Fatalf("archive tenant user: %v", err)
	}
	if archivedUser.MembershipStatus != "ARCHIVED" || archivedUser.MembershipArchivedAt == nil {
		t.Fatalf("tenant user not archived: %+v", archivedUser)
	}

	sessions, err := mem.ListTrainingSessions(ctx, tenantA.ID, cohort.ID)
	if err != nil {
		t.Fatalf("list sessions: %v", err)
	}
	if len(sessions) != 1 || sessions[0].ID != session.ID {
		t.Fatalf("session list mismatch: %+v", sessions)
	}
	audit, err := mem.ListAdminAuditLogs(ctx, tenantA.ID, "training_session", session.ID)
	if err != nil {
		t.Fatalf("audit: %v", err)
	}
	if len(audit) != 3 {
		t.Fatalf("expected create/update/archive session audit entries, got %+v", audit)
	}
	for _, entry := range audit {
		if entry.TenantID != tenantA.ID || entry.ActorUserID != "admin-a" {
			t.Fatalf("audit leaked or lost actor: %+v", entry)
		}
	}
}

func TestMemoryStoreUnknownTenantIsNotFound(t *testing.T) {
	ctx := context.Background()
	mem := store.NewMemoryStore()
	if _, err := mem.GetTenant(ctx, "does-not-exist"); !errors.Is(err, core.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for unknown tenant, got %v", err)
	}
}

func TestMemoryCohortAnalyticsAggregatesTrainingTime(t *testing.T) {
	ctx := context.Background()
	mem := store.NewMemoryStore()
	tenant, err := mem.CreateTenant(ctx, "Acme", "acme", "")
	if err != nil {
		t.Fatalf("tenant: %v", err)
	}
	program, err := mem.CreateProgram(ctx, tenant.ID, "Go Backend")
	if err != nil {
		t.Fatalf("program: %v", err)
	}
	cohort, err := mem.CreateCohort(ctx, tenant.ID, program.ID, "June", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("cohort: %v", err)
	}
	if _, err := mem.EnrollLearner(ctx, tenant.ID, cohort.ID, "learner-1"); err != nil {
		t.Fatalf("enroll: %v", err)
	}
	graph, err := mem.CreateDomain(ctx, tenant.ID, "trainer-1", "Go", "", "TRAINER",
		[]core.ConceptDraft{{ID: "c1", Name: "HTTP", Difficulty: 0.4}}, nil)
	if err != nil {
		t.Fatalf("domain: %v", err)
	}

	engine := runtime.NewEngine(mem).WithClock(func() time.Time {
		return time.Date(2026, 6, 5, 9, 0, 0, 0, time.UTC)
	})
	decision, err := engine.PlanNext(ctx, runtime.PlanNextInput{TenantID: tenant.ID, LearnerID: "learner-1", DomainID: graph.Domain.ID})
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	started, err := mem.StartActivity(ctx, tenant.ID, decision.Activity.ID)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if started.StartedAt == nil {
		t.Fatalf("started activity missing started_at: %+v", started)
	}
	completedAt := started.StartedAt.Add(90 * time.Minute)
	engine.WithClock(func() time.Time { return completedAt })
	if _, err := engine.SubmitAssessment(ctx, core.AssessmentSubmissionCommand{
		TenantID:   tenant.ID,
		LearnerID:  "learner-1",
		ActivityID: decision.Activity.ID,
		Answers: []core.AssessmentAnswer{
			{ItemID: "concept-check", ChoiceID: decision.Activity.ConceptID},
		},
	}); err != nil {
		t.Fatalf("submit assessment: %v", err)
	}

	analytics, err := mem.CohortAnalytics(ctx, tenant.ID, cohort.ID)
	if err != nil {
		t.Fatalf("analytics: %v", err)
	}
	if got, want := analytics["training_time_seconds"], int64(90*time.Minute/time.Second); got != want {
		t.Fatalf("training seconds=%v want=%d analytics=%+v", got, want, analytics)
	}
	if got := analytics["training_hours"]; got != 1.5 {
		t.Fatalf("training hours=%v want=1.5 analytics=%+v", got, analytics)
	}
	learnerTime, ok := analytics["learner_time"].([]core.TrainingTimeSummary)
	if !ok || len(learnerTime) != 1 {
		t.Fatalf("expected one learner time summary, got %#v", analytics["learner_time"])
	}
	if learnerTime[0].LearnerID != "learner-1" || learnerTime[0].TrainingTimeSeconds != int64(90*time.Minute/time.Second) || learnerTime[0].ActivityCount != 1 {
		t.Fatalf("unexpected learner time summary: %+v", learnerTime[0])
	}
}

func TestMemoryPauseExcludesTimeFromTraining(t *testing.T) {
	ctx := context.Background()
	mem := store.NewMemoryStore()
	tenant, err := mem.CreateTenant(ctx, "Acme", "acme-pause", "")
	if err != nil {
		t.Fatalf("tenant: %v", err)
	}
	program, err := mem.CreateProgram(ctx, tenant.ID, "Go Backend")
	if err != nil {
		t.Fatalf("program: %v", err)
	}
	cohort, err := mem.CreateCohort(ctx, tenant.ID, program.ID, "June", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("cohort: %v", err)
	}
	if _, err := mem.EnrollLearner(ctx, tenant.ID, cohort.ID, "learner-1"); err != nil {
		t.Fatalf("enroll: %v", err)
	}
	graph, err := mem.CreateDomain(ctx, tenant.ID, "trainer-1", "Go", "", "TRAINER",
		[]core.ConceptDraft{{ID: "c1", Name: "HTTP", Difficulty: 0.4}}, nil)
	if err != nil {
		t.Fatalf("domain: %v", err)
	}
	engine := runtime.NewEngine(mem)
	decision, err := engine.PlanNext(ctx, runtime.PlanNextInput{TenantID: tenant.ID, LearnerID: "learner-1", DomainID: graph.Domain.ID})
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	started, err := mem.StartActivity(ctx, tenant.ID, decision.Activity.ID)
	if err != nil {
		t.Fatalf("start: %v", err)
	}

	// Pause cannot precede start in the memory store guard.
	paused, err := mem.PauseActivity(ctx, tenant.ID, decision.Activity.ID)
	if err != nil {
		t.Fatalf("pause: %v", err)
	}
	if paused.PausedAt == nil {
		t.Fatalf("pause did not set paused_at: %+v", paused)
	}
	// Pausing twice keeps the original pause open (idempotent).
	again, err := mem.PauseActivity(ctx, tenant.ID, decision.Activity.ID)
	if err != nil {
		t.Fatalf("second pause: %v", err)
	}
	if again.PausedAt == nil || !again.PausedAt.Equal(*paused.PausedAt) {
		t.Fatalf("second pause moved paused_at: %+v vs %+v", again.PausedAt, paused.PausedAt)
	}

	// Complete 90 minutes later with the pause still open: the dangling pause is
	// folded in, so effectively no active time is counted (small real-clock slack).
	completedAt := started.StartedAt.Add(90 * time.Minute)
	engine.WithClock(func() time.Time { return completedAt })
	if _, err := engine.SubmitAssessment(ctx, core.AssessmentSubmissionCommand{
		TenantID:   tenant.ID,
		LearnerID:  "learner-1",
		ActivityID: decision.Activity.ID,
		Answers: []core.AssessmentAnswer{
			{ItemID: "concept-check", ChoiceID: decision.Activity.ConceptID},
		},
	}); err != nil {
		t.Fatalf("submit assessment: %v", err)
	}

	analytics, err := mem.CohortAnalytics(ctx, tenant.ID, cohort.ID)
	if err != nil {
		t.Fatalf("analytics: %v", err)
	}
	seconds, ok := analytics["training_time_seconds"].(int64)
	if !ok {
		t.Fatalf("training_time_seconds missing: %+v", analytics)
	}
	if seconds > 5 {
		t.Fatalf("paused time was counted as training: %d seconds", seconds)
	}
}

func TestMemoryResumeClosesPause(t *testing.T) {
	ctx := context.Background()
	mem := store.NewMemoryStore()
	tenant, err := mem.CreateTenant(ctx, "Acme", "acme-resume", "")
	if err != nil {
		t.Fatalf("tenant: %v", err)
	}
	graph, err := mem.CreateDomain(ctx, tenant.ID, "trainer-1", "Go", "", "TRAINER",
		[]core.ConceptDraft{{ID: "c1", Name: "HTTP", Difficulty: 0.4}}, nil)
	if err != nil {
		t.Fatalf("domain: %v", err)
	}
	engine := runtime.NewEngine(mem)
	decision, err := engine.PlanNext(ctx, runtime.PlanNextInput{TenantID: tenant.ID, LearnerID: "learner-1", DomainID: graph.Domain.ID})
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	if _, err := mem.PauseActivity(ctx, tenant.ID, decision.Activity.ID); err == nil {
		t.Fatalf("pausing a PLANNED activity should fail")
	}
	if _, err := mem.StartActivity(ctx, tenant.ID, decision.Activity.ID); err != nil {
		t.Fatalf("start: %v", err)
	}
	if _, err := mem.PauseActivity(ctx, tenant.ID, decision.Activity.ID); err != nil {
		t.Fatalf("pause: %v", err)
	}
	resumed, err := mem.ResumeActivity(ctx, tenant.ID, decision.Activity.ID)
	if err != nil {
		t.Fatalf("resume: %v", err)
	}
	if resumed.PausedAt != nil {
		t.Fatalf("resume left paused_at set: %+v", resumed)
	}
	if resumed.PausedSeconds < 0 {
		t.Fatalf("negative paused seconds: %+v", resumed)
	}
}
