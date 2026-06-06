package runtime

import (
	"fmt"
	"sort"

	"lore/internal/core"
)

func ValidateGraph(concepts []core.Concept, deps []core.Dependency) error {
	known := make(map[string]core.Concept, len(concepts))
	for _, concept := range concepts {
		if concept.ID == "" {
			return fmt.Errorf("%w: concept id is required", core.ErrInvalidInput)
		}
		if concept.TenantID == "" || concept.DomainID == "" {
			return fmt.Errorf("%w: concept %s is missing tenant or domain", core.ErrInvalidInput, concept.ID)
		}
		if _, exists := known[concept.ID]; exists {
			return fmt.Errorf("%w: duplicate concept %s", core.ErrConflict, concept.ID)
		}
		known[concept.ID] = concept
	}

	edges := make(map[string][]string, len(concepts))
	for _, dep := range deps {
		if dep.ParentConceptID == dep.ChildConceptID {
			return fmt.Errorf("%w: self dependency %s", core.ErrInvalidInput, dep.ParentConceptID)
		}
		parent, ok := known[dep.ParentConceptID]
		if !ok {
			return fmt.Errorf("%w: unknown parent concept %s", core.ErrInvalidInput, dep.ParentConceptID)
		}
		child, ok := known[dep.ChildConceptID]
		if !ok {
			return fmt.Errorf("%w: unknown child concept %s", core.ErrInvalidInput, dep.ChildConceptID)
		}
		if parent.TenantID != child.TenantID || parent.DomainID != child.DomainID {
			return fmt.Errorf("%w: dependency crosses tenant or domain", core.ErrTenantMismatch)
		}
		if dep.TenantID != parent.TenantID || dep.DomainID != parent.DomainID {
			return fmt.Errorf("%w: dependency metadata crosses tenant or domain", core.ErrTenantMismatch)
		}
		edges[dep.ParentConceptID] = append(edges[dep.ParentConceptID], dep.ChildConceptID)
	}

	for _, children := range edges {
		sort.Strings(children)
	}

	visiting := map[string]bool{}
	visited := map[string]bool{}
	var visit func(string) error
	visit = func(id string) error {
		if visiting[id] {
			return fmt.Errorf("%w: concept graph contains a cycle at %s", core.ErrInvalidInput, id)
		}
		if visited[id] {
			return nil
		}
		visiting[id] = true
		for _, child := range edges[id] {
			if err := visit(child); err != nil {
				return err
			}
		}
		visiting[id] = false
		visited[id] = true
		return nil
	}

	ids := make([]string, 0, len(known))
	for id := range known {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		if err := visit(id); err != nil {
			return err
		}
	}
	return nil
}

func PrerequisitesByChild(deps []core.Dependency) map[string][]string {
	result := make(map[string][]string)
	for _, dep := range deps {
		result[dep.ChildConceptID] = append(result[dep.ChildConceptID], dep.ParentConceptID)
	}
	for child := range result {
		sort.Strings(result[child])
	}
	return result
}
