// Topologically order a subset of concepts along the domain DAG. This mirrors the
// runtime's prerequisite-respecting sequence (runtime-decided) — the UI never invents
// pedagogy, it reads the dependency edges the trainer's domain already declares.
import type { Concept, Dependency } from "@/lib/types";

export interface OrderedConcept {
  concept: Concept;
  prereqs: string[]; // names of direct prerequisites that are also in the selection
}

// Dependency edge is parent_concept_id -> child_concept_id, where the child is a
// prerequisite of the parent (child must be learned before parent). We sequence so
// prerequisites come first.
export function orderConcepts(
  ids: string[],
  concepts: Concept[],
  deps: Dependency[]
): OrderedConcept[] {
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const selected = ids.filter((id) => byId.has(id));
  const set = new Set(selected);

  // prereq map: concept -> set of its prerequisites (children) within the selection
  const prereqOf = new Map<string, Set<string>>();
  for (const id of selected) prereqOf.set(id, new Set());
  for (const d of deps) {
    if (set.has(d.parent_concept_id) && set.has(d.child_concept_id)) {
      prereqOf.get(d.parent_concept_id)!.add(d.child_concept_id);
    }
  }

  // Kahn's algorithm, deterministic (stable by difficulty then id).
  const ordered: string[] = [];
  const remaining = new Set(selected);
  const stableSort = (xs: string[]) =>
    xs.sort((a, b) => {
      const da = byId.get(a)?.difficulty ?? 0;
      const db = byId.get(b)?.difficulty ?? 0;
      return da - db || a.localeCompare(b);
    });

  while (remaining.size) {
    const ready = stableSort(
      [...remaining].filter((id) => [...(prereqOf.get(id) ?? [])].every((p) => !remaining.has(p)))
    );
    if (ready.length === 0) {
      // cycle / unsatisfiable — append the rest deterministically rather than loop.
      ordered.push(...stableSort([...remaining]));
      break;
    }
    for (const id of ready) {
      ordered.push(id);
      remaining.delete(id);
    }
  }

  return ordered.map((id) => ({
    concept: byId.get(id)!,
    prereqs: [...(prereqOf.get(id) ?? [])].map((p) => byId.get(p)?.name ?? p),
  }));
}
