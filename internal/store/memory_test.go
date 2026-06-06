package store_test

import (
	"context"
	"errors"
	"testing"

	"lore/internal/core"
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

func TestMemoryStoreUnknownTenantIsNotFound(t *testing.T) {
	ctx := context.Background()
	mem := store.NewMemoryStore()
	if _, err := mem.GetTenant(ctx, "does-not-exist"); !errors.Is(err, core.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for unknown tenant, got %v", err)
	}
}
