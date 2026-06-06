package runtime

import (
	"errors"
	"testing"

	"lore/internal/core"
)

func TestValidateGraphRejectsCyclesAndUnknownConcepts(t *testing.T) {
	concepts := []core.Concept{
		{TenantID: "tenant", DomainID: "domain", ID: "a", Name: "A"},
		{TenantID: "tenant", DomainID: "domain", ID: "b", Name: "B"},
	}
	if err := ValidateGraph(concepts, []core.Dependency{{
		TenantID: "tenant", DomainID: "domain", ParentConceptID: "a", ChildConceptID: "b",
	}}); err != nil {
		t.Fatalf("valid DAG rejected: %v", err)
	}

	err := ValidateGraph(concepts, []core.Dependency{
		{TenantID: "tenant", DomainID: "domain", ParentConceptID: "a", ChildConceptID: "b"},
		{TenantID: "tenant", DomainID: "domain", ParentConceptID: "b", ChildConceptID: "a"},
	})
	if !errors.Is(err, core.ErrInvalidInput) {
		t.Fatalf("cycle should be invalid input, got %v", err)
	}

	err = ValidateGraph(concepts, []core.Dependency{{
		TenantID: "tenant", DomainID: "domain", ParentConceptID: "missing", ChildConceptID: "a",
	}})
	if !errors.Is(err, core.ErrInvalidInput) {
		t.Fatalf("unknown concept should be invalid input, got %v", err)
	}
}

func TestValidateGraphRejectsCrossDomainEdges(t *testing.T) {
	concepts := []core.Concept{
		{TenantID: "tenant", DomainID: "d1", ID: "a", Name: "A"},
		{TenantID: "tenant", DomainID: "d2", ID: "b", Name: "B"},
	}
	err := ValidateGraph(concepts, []core.Dependency{{
		TenantID: "tenant", DomainID: "d1", ParentConceptID: "a", ChildConceptID: "b",
	}})
	if !errors.Is(err, core.ErrTenantMismatch) {
		t.Fatalf("cross-domain edge should be tenant mismatch, got %v", err)
	}
}
