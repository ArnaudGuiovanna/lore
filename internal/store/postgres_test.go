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
	for _, required := range []string{"TenantCreated", "InteractionRecorded", "LearnerStateUpdated", "ReviewScheduled"} {
		if !seen[required] {
			t.Fatalf("missing durable event %q; got %v", required, seen)
		}
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
