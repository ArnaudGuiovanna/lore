package store_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"
	"time"

	"lore/internal/core"
	"lore/internal/runtime"
	"lore/internal/store"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newPostgresTestStore returns a PostgresStore backed by a freshly migrated
// schema. It skips the test when LORE_TEST_DATABASE_URL is not configured so the
// default `go test ./...` run stays dependency-free, while CI (which provides a
// Postgres service) exercises the durable path.
func newPostgresTestStore(t *testing.T) (*store.PostgresStore, *pgxpool.Pool) {
	t.Helper()
	url := os.Getenv("LORE_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("LORE_TEST_DATABASE_URL not set; skipping Postgres integration test")
	}
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("connect raw pool: %v", err)
	}
	// Reset to a clean, deterministic schema for each run.
	if _, err := pool.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		t.Fatalf("reset schema: %v", err)
	}

	st, err := store.NewPostgresStore(ctx, url)
	if err != nil {
		t.Fatalf("new postgres store: %v", err)
	}
	if err := st.ApplyMigrationFile(ctx, "000001_init", "../../db/migrations/000001_init.sql"); err != nil {
		t.Fatalf("apply migration: %v", err)
	}
	if err := st.ApplyMigrationFile(ctx, "000002_admin_crud", "../../db/migrations/000002_admin_crud.sql"); err != nil {
		t.Fatalf("apply admin migration: %v", err)
	}
	t.Cleanup(func() {
		st.Close()
		pool.Close()
	})
	return st, pool
}

func seedDomain(t *testing.T, st *store.PostgresStore, tenantName, slug string) (tenantID, domainID string) {
	t.Helper()
	ctx := context.Background()
	tenant, err := st.CreateTenant(ctx, tenantName, slug, "")
	if err != nil {
		t.Fatalf("create tenant: %v", err)
	}
	graph, err := st.CreateDomain(ctx, tenant.ID, "trainer-1", "Go Backend", "Backend fundamentals", "TRAINER",
		[]core.ConceptDraft{
			{ID: "concept-a", Name: "HTTP handlers", Difficulty: 0.4},
			{ID: "concept-b", Name: "Persistence", Difficulty: 0.7},
		},
		[]core.DependencyDraft{
			{ParentConceptID: "concept-a", ChildConceptID: "concept-b"},
		})
	if err != nil {
		t.Fatalf("create domain: %v", err)
	}
	return tenant.ID, graph.Domain.ID
}

func TestPostgresRuntimeFlowPersistsStateReviewsAndEvents(t *testing.T) {
	ctx := context.Background()
	st, _ := newPostgresTestStore(t)
	tenantID, domainID := seedDomain(t, st, "Acme", "acme")

	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	engine := runtime.NewEngine(st).WithClock(func() time.Time { return now })

	decision, err := engine.PlanNext(ctx, runtime.PlanNextInput{TenantID: tenantID, LearnerID: "learner-1", DomainID: domainID})
	if err != nil {
		t.Fatalf("plan next: %v", err)
	}
	if decision.TutorInstruction.Context["phase"] != core.PhaseDiagnostic {
		t.Fatalf("expected diagnostic phase, got %+v", decision.TutorInstruction.Context["phase"])
	}

	if _, err := engine.RecordInteraction(ctx, core.InteractionCommand{
		TenantID: tenantID, LearnerID: "learner-1", ActivityID: decision.Activity.ID, Score: 1.5, Success: true,
	}); !errors.Is(err, core.ErrInvalidInput) {
		t.Fatalf("invalid score should be rejected, got %v", err)
	}

	delta, err := engine.RecordInteraction(ctx, core.InteractionCommand{
		TenantID: tenantID, LearnerID: "learner-1", ActivityID: decision.Activity.ID, Score: 0.92, Success: true, Feedback: "clear",
	})
	if err != nil {
		t.Fatalf("record interaction: %v", err)
	}
	if delta.After.Mastery <= delta.Before.Mastery {
		t.Fatalf("mastery did not increase: before=%f after=%f", delta.Before.Mastery, delta.After.Mastery)
	}
	if delta.After.DueAt == nil || !delta.After.DueAt.After(now) {
		t.Fatalf("expected a future review due date, got %v", delta.After.DueAt)
	}

	// Durable learner state is persisted and tenant-scoped.
	states, err := engine.GetLearnerModel(ctx, tenantID, "learner-1")
	if err != nil {
		t.Fatalf("learner model: %v", err)
	}
	if len(states) == 0 {
		t.Fatal("expected persisted learner state")
	}
	for _, s := range states {
		if s.TenantID != tenantID {
			t.Fatalf("state tenant leaked: got %s want %s", s.TenantID, tenantID)
		}
	}

	// The outbox captured the lifecycle events in the same durable store.
	events, err := st.ListEvents(ctx, tenantID, false)
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	seen := map[string]bool{}
	for _, e := range events {
		seen[e.EventType] = true
	}
	for _, required := range []string{"TenantCreated", "ConceptGraphPublished", "InteractionRecorded", "LearnerStateUpdated", "ReviewScheduled"} {
		if !seen[required] {
			t.Fatalf("missing durable event %q; got %v", required, seen)
		}
	}
}

func TestPostgresCohortAnalyticsAggregatesTrainingTime(t *testing.T) {
	ctx := context.Background()
	st, _ := newPostgresTestStore(t)
	tenantID, domainID := seedDomain(t, st, "Acme", "acme")
	program, err := st.CreateProgram(ctx, tenantID, "Go Backend")
	if err != nil {
		t.Fatalf("program: %v", err)
	}
	cohort, err := st.CreateCohort(ctx, tenantID, program.ID, "June", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("cohort: %v", err)
	}
	if _, err := st.EnrollLearner(ctx, tenantID, cohort.ID, "learner-1"); err != nil {
		t.Fatalf("enroll: %v", err)
	}
	engine := runtime.NewEngine(st).WithClock(func() time.Time {
		return time.Date(2026, 6, 5, 9, 0, 0, 0, time.UTC)
	})
	decision, err := engine.PlanNext(ctx, runtime.PlanNextInput{TenantID: tenantID, LearnerID: "learner-1", DomainID: domainID, Intent: "assessment"})
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	started, err := st.StartActivity(ctx, tenantID, decision.Activity.ID)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if started.StartedAt == nil {
		t.Fatalf("started activity missing started_at: %+v", started)
	}
	completedAt := started.StartedAt.Add(90 * time.Minute)
	engine.WithClock(func() time.Time { return completedAt })
	if _, err := engine.SubmitAssessment(ctx, core.AssessmentSubmissionCommand{
		TenantID:   tenantID,
		LearnerID:  "learner-1",
		ActivityID: decision.Activity.ID,
		Answers: []core.AssessmentAnswer{
			{ItemID: "concept-check", ChoiceID: decision.Activity.ConceptID},
		},
	}); err != nil {
		t.Fatalf("submit assessment: %v", err)
	}

	analytics, err := st.CohortAnalytics(ctx, tenantID, cohort.ID)
	if err != nil {
		t.Fatalf("analytics: %v", err)
	}
	if got, want := analytics["training_time_seconds"], int64(90*time.Minute/time.Second); got != want {
		t.Fatalf("training seconds=%v want=%d analytics=%+v", got, want, analytics)
	}
	learnerTime, ok := analytics["learner_time"].([]core.TrainingTimeSummary)
	if !ok || len(learnerTime) != 1 {
		t.Fatalf("expected one learner time summary, got %#v", analytics["learner_time"])
	}
	if learnerTime[0].LearnerID != "learner-1" || learnerTime[0].ActivityCount != 1 {
		t.Fatalf("unexpected learner time summary: %+v", learnerTime[0])
	}
}

func TestPostgresPersistsMisconceptionsAndV1Events(t *testing.T) {
	ctx := context.Background()
	st, _ := newPostgresTestStore(t)
	tenantID, domainID := seedDomain(t, st, "Acme", "acme")
	user, err := st.CreateUser(ctx, "learner@example.test", "Learner")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	if _, err := st.AddMembership(ctx, tenantID, user.ID, core.RoleLearner); err != nil {
		t.Fatalf("add membership: %v", err)
	}

	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	engine := runtime.NewEngine(st).WithClock(func() time.Time { return now })
	decision, err := engine.PlanNext(ctx, runtime.PlanNextInput{TenantID: tenantID, LearnerID: user.ID, DomainID: domainID})
	if err != nil {
		t.Fatalf("plan initial: %v", err)
	}
	delta, err := engine.RecordInteraction(ctx, core.InteractionCommand{
		TenantID: tenantID, LearnerID: user.ID, ActivityID: decision.Activity.ID, Score: 0.10, Success: false, ErrorType: "off_by_one",
	})
	if err != nil {
		t.Fatalf("record failed interaction: %v", err)
	}
	if len(delta.Misconceptions) != 1 || delta.Misconceptions[0].Status != "ACTIVE" {
		t.Fatalf("expected one active misconception change, got %+v", delta.Misconceptions)
	}
	active, err := st.ListActiveMisconceptions(ctx, tenantID, user.ID, domainID)
	if err != nil {
		t.Fatalf("list active misconceptions: %v", err)
	}
	if len(active) != 1 || active[0].Description != "off_by_one" {
		t.Fatalf("active misconception not persisted: %+v", active)
	}

	alerts, err := st.ListAlerts(ctx, tenantID, now)
	if err != nil {
		t.Fatalf("list alerts: %v", err)
	}
	if !hasAlert(alerts, "ReviewDue") {
		t.Fatalf("expected ReviewDue alert, got %+v", alerts)
	}
	repair, err := engine.PlanNext(ctx, runtime.PlanNextInput{TenantID: tenantID, LearnerID: user.ID, DomainID: domainID})
	if err != nil {
		t.Fatalf("plan repair: %v", err)
	}
	if repair.Activity.ActivityType != core.ActivityMisconception {
		t.Fatalf("expected misconception activity before review, got %s", repair.Activity.ActivityType)
	}
	if _, err := engine.RecordInteraction(ctx, core.InteractionCommand{
		TenantID: tenantID, LearnerID: user.ID, ActivityID: repair.Activity.ID, Score: 0.95, Success: true,
	}); err != nil {
		t.Fatalf("record repair interaction: %v", err)
	}
	active, err = st.ListActiveMisconceptions(ctx, tenantID, user.ID, domainID)
	if err != nil {
		t.Fatalf("list active misconceptions after repair: %v", err)
	}
	if len(active) != 0 {
		t.Fatalf("misconception should be resolved, got %+v", active)
	}

	events, err := st.ListEvents(ctx, tenantID, false)
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	for _, required := range []string{"UserCreated", "MisconceptionDetected", "ReviewDue", "MisconceptionResolved"} {
		if !hasEvent(events, required) {
			t.Fatalf("missing event %q; got %+v", required, events)
		}
	}
}

func TestPostgresPersistsLearnerAtRiskDomainEvent(t *testing.T) {
	ctx := context.Background()
	st, _ := newPostgresTestStore(t)
	tenantID, domainID := seedDomain(t, st, "Risk", "risk")

	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	engine := runtime.NewEngine(st).WithClock(func() time.Time { return now })
	for range 3 {
		decision, err := engine.PlanNext(ctx, runtime.PlanNextInput{TenantID: tenantID, LearnerID: "learner-risk", DomainID: domainID})
		if err != nil {
			t.Fatalf("plan failed activity: %v", err)
		}
		if _, err := engine.RecordInteraction(ctx, core.InteractionCommand{
			TenantID: tenantID, LearnerID: "learner-risk", ActivityID: decision.Activity.ID, Score: 0.10, Success: false,
		}); err != nil {
			t.Fatalf("record failed interaction: %v", err)
		}
	}
	alerts, err := st.ListAlerts(ctx, tenantID, now)
	if err != nil {
		t.Fatalf("list alerts: %v", err)
	}
	if !hasAlert(alerts, "LearnerAtRisk") {
		t.Fatalf("expected LearnerAtRisk alert, got %+v", alerts)
	}
	events, err := st.ListEvents(ctx, tenantID, false)
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	if !hasEvent(events, "LearnerAtRisk") {
		t.Fatalf("missing LearnerAtRisk event; got %+v", events)
	}
}

func TestPostgresTenantIsolationEnforcedByRLS(t *testing.T) {
	ctx := context.Background()
	st, pool := newPostgresTestStore(t)

	tenantA, _ := seedDomain(t, st, "Alpha", "alpha")
	tenantB, _ := seedDomain(t, st, "Beta", "beta")

	userA, err := st.CreateUser(ctx, "a@example.test", "A")
	if err != nil {
		t.Fatalf("user a: %v", err)
	}
	userB, err := st.CreateUser(ctx, "b@example.test", "B")
	if err != nil {
		t.Fatalf("user b: %v", err)
	}
	if _, err := st.AddMembership(ctx, tenantA, userA.ID, core.RoleTrainer); err != nil {
		t.Fatalf("membership a: %v", err)
	}
	if _, err := st.AddMembership(ctx, tenantB, userB.ID, core.RoleTrainer); err != nil {
		t.Fatalf("membership b: %v", err)
	}

	// Store-level scoping: tenant A only sees its own membership.
	membersA, err := st.ListMemberships(ctx, tenantA)
	if err != nil {
		t.Fatalf("list memberships a: %v", err)
	}
	if len(membersA) != 1 || membersA[0].UserID != userA.ID {
		t.Fatalf("tenant A membership listing leaked: %+v", membersA)
	}

	// Database-level RLS: a connection scoped to tenant A cannot read tenant B's
	// rows even with a direct query, and an unscoped connection sees nothing.
	var countForA, countUnscoped int
	if err := withAppTenant(ctx, pool, tenantA, func(scoped queryRower) error {
		return scoped.QueryRow(ctx, `SELECT count(*) FROM memberships WHERE tenant_id::text = $1`, tenantB).Scan(&countForA)
	}); err != nil {
		t.Fatalf("scoped query: %v", err)
	}
	if countForA != 0 {
		t.Fatalf("RLS leak: tenant A scope read %d of tenant B's memberships", countForA)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM memberships`).Scan(&countUnscoped); err != nil {
		t.Fatalf("unscoped query: %v", err)
	}
	if countUnscoped != 0 {
		t.Fatalf("RLS leak: unscoped connection read %d memberships", countUnscoped)
	}
}

func TestPostgresTenantScopedListMethods(t *testing.T) {
	ctx := context.Background()
	st, _ := newPostgresTestStore(t)

	tenantA, domainA := seedDomain(t, st, "Alpha", "alpha")
	tenantB, domainB := seedDomain(t, st, "Beta", "beta")
	programA, err := st.CreateProgram(ctx, tenantA, "Go Backend")
	if err != nil {
		t.Fatalf("create program a: %v", err)
	}
	programB, err := st.CreateProgram(ctx, tenantB, "Rust Backend")
	if err != nil {
		t.Fatalf("create program b: %v", err)
	}
	cohortA, err := st.CreateCohort(ctx, tenantA, programA.ID, "June", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("create cohort a: %v", err)
	}
	cohortB, err := st.CreateCohort(ctx, tenantB, programB.ID, "July", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("create cohort b: %v", err)
	}
	syllabusA, err := st.CreateSyllabus(ctx, tenantA, "Go Syllabus", "", nil, nil)
	if err != nil {
		t.Fatalf("create syllabus a: %v", err)
	}
	if _, err := st.CreateSyllabus(ctx, tenantB, "Rust Syllabus", "", nil, nil); err != nil {
		t.Fatalf("create syllabus b: %v", err)
	}
	learnerA, err := st.CreateUser(ctx, "learner-a@example.test", "Learner A")
	if err != nil {
		t.Fatalf("create learner a: %v", err)
	}
	trainerA, err := st.CreateUser(ctx, "trainer-a@example.test", "Trainer A")
	if err != nil {
		t.Fatalf("create trainer a: %v", err)
	}
	learnerB, err := st.CreateUser(ctx, "learner-b@example.test", "Learner B")
	if err != nil {
		t.Fatalf("create learner b: %v", err)
	}
	if _, err := st.AddMembership(ctx, tenantA, learnerA.ID, core.RoleLearner); err != nil {
		t.Fatalf("learner membership a: %v", err)
	}
	if _, err := st.AddMembership(ctx, tenantA, trainerA.ID, core.RoleTrainer); err != nil {
		t.Fatalf("trainer membership a: %v", err)
	}
	if _, err := st.AddMembership(ctx, tenantB, learnerB.ID, core.RoleLearner); err != nil {
		t.Fatalf("learner membership b: %v", err)
	}
	enrollmentA, err := st.EnrollLearner(ctx, tenantA, cohortA.ID, learnerA.ID)
	if err != nil {
		t.Fatalf("enroll learner a: %v", err)
	}
	if _, err := st.EnrollLearner(ctx, tenantB, cohortB.ID, learnerB.ID); err != nil {
		t.Fatalf("enroll learner b: %v", err)
	}

	tenants, err := st.ListTenants(ctx)
	if err != nil {
		t.Fatalf("list tenants: %v", err)
	}
	if len(tenants) != 2 {
		t.Fatalf("expected two tenants, got %+v", tenants)
	}
	programs, err := st.ListPrograms(ctx, tenantA)
	if err != nil {
		t.Fatalf("list programs a: %v", err)
	}
	if len(programs) != 1 || programs[0].ID != programA.ID || programs[0].TenantID != tenantA {
		t.Fatalf("program list leaked or missed data: %+v", programs)
	}
	cohorts, err := st.ListCohorts(ctx, tenantA)
	if err != nil {
		t.Fatalf("list cohorts a: %v", err)
	}
	if len(cohorts) != 1 || cohorts[0].ID != cohortA.ID || cohorts[0].TenantID != tenantA {
		t.Fatalf("cohort list leaked or missed data: %+v", cohorts)
	}
	syllabi, err := st.ListSyllabi(ctx, tenantA)
	if err != nil {
		t.Fatalf("list syllabi a: %v", err)
	}
	if len(syllabi) != 1 || syllabi[0].ID != syllabusA.ID || syllabi[0].TenantID != tenantA {
		t.Fatalf("syllabus list leaked or missed data: %+v", syllabi)
	}
	domains, err := st.ListDomains(ctx, tenantA)
	if err != nil {
		t.Fatalf("list domains a: %v", err)
	}
	if len(domains) != 1 || domains[0].ID != domainA || domains[0].TenantID != tenantA {
		t.Fatalf("domain list leaked or missed data: got %+v want domain %s; tenant B domain %s", domains, domainA, domainB)
	}
	memberships, err := st.ListMemberships(ctx, tenantA)
	if err != nil {
		t.Fatalf("list memberships a: %v", err)
	}
	if len(memberships) != 2 {
		t.Fatalf("membership list leaked or missed data: %+v", memberships)
	}
	learners, err := st.ListLearners(ctx, tenantA)
	if err != nil {
		t.Fatalf("list learners a: %v", err)
	}
	if len(learners) != 1 || learners[0].UserID != learnerA.ID || learners[0].TenantID != tenantA {
		t.Fatalf("learner list leaked or missed data: %+v", learners)
	}
	enrollments, err := st.ListCohortEnrollments(ctx, tenantA, cohortA.ID)
	if err != nil {
		t.Fatalf("list enrollments a: %v", err)
	}
	if len(enrollments) != 1 || enrollments[0].LearnerID != enrollmentA.LearnerID || enrollments[0].TenantID != tenantA {
		t.Fatalf("enrollment list leaked or missed data: %+v", enrollments)
	}
	if _, err := st.ListCohortEnrollments(ctx, tenantA, cohortB.ID); !errors.Is(err, core.ErrNotFound) {
		t.Fatalf("expected cross-tenant cohort enrollment list to be not found, got %v", err)
	}
}

func TestPostgresAdminCRUDSessionsAndAudit(t *testing.T) {
	ctx := context.Background()
	st, _ := newPostgresTestStore(t)
	tenantA, _ := seedDomain(t, st, "Alpha", "alpha")
	tenantB, _ := seedDomain(t, st, "Beta", "beta")
	learner, err := st.CreateUser(ctx, "learner-admin@example.test", "Learner")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	if _, err := st.AddMembership(ctx, tenantA, learner.ID, core.RoleLearner, "admin-a"); err != nil {
		t.Fatalf("membership: %v", err)
	}
	programA, err := st.CreateProgram(ctx, tenantA, "Go Backend", "admin-a")
	if err != nil {
		t.Fatalf("program a: %v", err)
	}
	programB, err := st.CreateProgram(ctx, tenantB, "Rust Backend", "admin-b")
	if err != nil {
		t.Fatalf("program b: %v", err)
	}
	if _, err := st.UpdateProgram(ctx, tenantA, programB.ID, "Leak", "", "admin-a"); !errors.Is(err, core.ErrNotFound) {
		t.Fatalf("cross-tenant program update should be not found, got %v", err)
	}
	programA, err = st.UpdateProgram(ctx, tenantA, programA.ID, "Go Backend Advanced", "ACTIVE", "admin-a")
	if err != nil {
		t.Fatalf("update program: %v", err)
	}
	if programA.Name != "Go Backend Advanced" || programA.UpdatedAt.IsZero() {
		t.Fatalf("program not updated: %+v", programA)
	}
	cohort, err := st.CreateCohort(ctx, tenantA, programA.ID, "June", time.Time{}, time.Time{}, "admin-a")
	if err != nil {
		t.Fatalf("cohort: %v", err)
	}
	if _, err := st.EnrollLearner(ctx, tenantA, cohort.ID, learner.ID, "admin-a"); err != nil {
		t.Fatalf("enroll: %v", err)
	}
	enrollment, err := st.UpdateCohortEnrollmentStatus(ctx, tenantA, cohort.ID, learner.ID, "COMPLETED", "admin-a")
	if err != nil {
		t.Fatalf("update enrollment: %v", err)
	}
	if enrollment.Status != "COMPLETED" {
		t.Fatalf("enrollment status=%s", enrollment.Status)
	}
	startsAt := time.Date(2026, 6, 10, 9, 0, 0, 0, time.UTC)
	session, err := st.CreateTrainingSession(ctx, core.TrainingSession{
		TenantID: tenantA,
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
	status := "COMPLETED"
	session, err = st.UpdateTrainingSession(ctx, tenantA, session.ID, core.TrainingSessionPatch{Status: &status}, "admin-a")
	if err != nil {
		t.Fatalf("update session: %v", err)
	}
	if session.Status != "COMPLETED" {
		t.Fatalf("session status not updated: %+v", session)
	}
	session, err = st.ArchiveTrainingSession(ctx, tenantA, session.ID, "admin-a")
	if err != nil {
		t.Fatalf("archive session: %v", err)
	}
	if session.Status != "ARCHIVED" || session.ArchivedAt == nil {
		t.Fatalf("session not archived: %+v", session)
	}
	tenantUser, err := st.ArchiveTenantUser(ctx, tenantA, learner.ID, "admin-a")
	if err != nil {
		t.Fatalf("archive tenant user: %v", err)
	}
	if tenantUser.MembershipStatus != "ARCHIVED" || tenantUser.MembershipArchivedAt == nil {
		t.Fatalf("tenant user not archived: %+v", tenantUser)
	}
	audit, err := st.ListAdminAuditLogs(ctx, tenantA, "training_session", session.ID)
	if err != nil {
		t.Fatalf("audit: %v", err)
	}
	if len(audit) != 3 {
		t.Fatalf("expected create/update/archive session audit entries, got %+v", audit)
	}
	for _, entry := range audit {
		if entry.TenantID != tenantA || entry.ActorUserID != "admin-a" {
			t.Fatalf("audit leaked or lost actor: %+v", entry)
		}
	}
}

func TestPostgresIdempotencyRecordRoundTrip(t *testing.T) {
	ctx := context.Background()
	st, _ := newPostgresTestStore(t)
	tenantID, _ := seedDomain(t, st, "Acme", "acme")

	if _, err := st.GetIdempotencyRecord(ctx, tenantID, "key-1"); !errors.Is(err, core.ErrNotFound) {
		t.Fatalf("expected not-found before save, got %v", err)
	}

	record := core.IdempotencyRecord{
		TenantID:   tenantID,
		Key:        "key-1",
		StatusCode: 201,
		Response:   []byte(`{"ok":true}`),
		CreatedAt:  time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC),
	}
	if err := st.SaveIdempotencyRecord(ctx, record); err != nil {
		t.Fatalf("save idempotency record: %v", err)
	}

	got, err := st.GetIdempotencyRecord(ctx, tenantID, "key-1")
	if err != nil {
		t.Fatalf("get idempotency record: %v", err)
	}
	if got.StatusCode != 201 {
		t.Fatalf("idempotency status mismatch: got %d want 201", got.StatusCode)
	}
	// The response is stored as jsonb, so compare semantically rather than
	// byte-for-byte (Postgres normalizes whitespace and key ordering).
	var gotJSON, wantJSON map[string]any
	if err := json.Unmarshal(got.Response, &gotJSON); err != nil {
		t.Fatalf("unmarshal stored response %q: %v", got.Response, err)
	}
	if err := json.Unmarshal(record.Response, &wantJSON); err != nil {
		t.Fatalf("unmarshal expected response: %v", err)
	}
	if !reflect.DeepEqual(gotJSON, wantJSON) {
		t.Fatalf("idempotency replay mismatch: got %v want %v", gotJSON, wantJSON)
	}
}

type queryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func withAppTenant(ctx context.Context, pool *pgxpool.Pool, tenantID string, fn func(queryRower) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT set_config('app.tenant_id', $1, true)`, tenantID); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func hasAlert(alerts []core.Alert, alertType string) bool {
	for _, alert := range alerts {
		if alert.AlertType == alertType {
			return true
		}
	}
	return false
}

func hasEvent(events []core.Event, eventType string) bool {
	for _, event := range events {
		if event.EventType == eventType {
			return true
		}
	}
	return false
}
