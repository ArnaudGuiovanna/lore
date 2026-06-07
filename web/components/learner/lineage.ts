// Builds the read-only PROVENANCE lineage for a concept.
//
// Two kinds of links, kept honest and distinct:
//  - REAL binding: cohort -> bound syllabus (SyllabusBound, GUIDED). This is a stored
//    relationship from the seed.
//  - PRESENTATIONAL trace: concept -> objective/outcome, and "runtime planned this step".
//    The runtime plans on the concept graph; the objective/outcome mapping is a provenance
//    trace, not a stored field. Marked as such so the learner is never misled.
import type { Concept, Dependency } from "@/lib/types";

export interface LineageNode {
  id: string;
  label: string;
  detail?: string;
  // "binding" = real stored link; "trace" = presentational provenance.
  kind: "binding" | "trace";
}

// The bound syllabus title (from the trainer-owned syllabus on cohort Go-Spring-24).
export const BOUND_SYLLABUS_TITLE = "Production-grade Go persistence";

// Prerequisites of a concept that are not yet mastered are "locked" gates the
// runtime added on the DAG — surfaced honestly rather than hidden.
export function prerequisites(deps: Dependency[], conceptId: string): string[] {
  return deps.filter((d) => d.child_concept_id === conceptId).map((d) => d.parent_concept_id);
}

export function unlocks(deps: Dependency[], conceptId: string): string[] {
  return deps.filter((d) => d.parent_concept_id === conceptId).map((d) => d.child_concept_id);
}

// The concepts the trainer-authored syllabus names as its objectives. The seed's
// "Production-grade Go persistence" syllabus drives toward persistence + transactions;
// everything else the runtime planned on the DAG (prerequisites, retention upkeep).
export const SYLLABUS_OBJECTIVES = new Set(["persistence", "transactions"]);

// The single outcome the bound syllabus drives toward (trainer-owned acquis).
export const BOUND_OUTCOME =
  "writes a handler that persists in a transaction and rolls back on error";

export type ServesKind = "objective" | "prerequisite" | "retention";

export interface ServesTrace {
  kind: ServesKind;
  // The honest pill label: a real syllabus objective vs. runtime-planned work.
  pill: string;
  // A read-only provenance note (not a stored field — the runtime plans on the DAG).
  note: string;
}

// Honest provenance trace for a concept on PROGRESS: is it a syllabus OBJECTIVE,
// a runtime-added PREREQUISITE that feeds an objective, or off-objective RETENTION
// upkeep the runtime scheduled? Never claims every concept "serves an objective".
export function servesTrace(
  deps: Dependency[],
  concepts: Concept[],
  conceptId: string
): ServesTrace {
  if (SYLLABUS_OBJECTIVES.has(conceptId)) {
    const isFinal = unlocks(deps, conceptId).every((c) => !SYLLABUS_OBJECTIVES.has(c));
    return {
      kind: "objective",
      pill: `objective · ${conceptId}`,
      note:
        conceptId === "persistence"
          ? `the outcome: “${BOUND_OUTCOME}”`
          : isFinal
            ? "the syllabus’ final objective; gated behind persistence"
            : "a syllabus objective",
    };
  }
  // Does any objective depend (transitively, one hop) on this concept?
  const feedsObjective = unlocks(deps, conceptId).some((c) => SYLLABUS_OBJECTIVES.has(c));
  if (feedsObjective) {
    return {
      kind: "prerequisite",
      pill: "runtime-added prerequisite",
      note: "not a syllabus objective; the runtime planned it to support persistence",
    };
  }
  return {
    kind: "retention",
    pill: "outside syllabus objectives",
    note: "kept for retention upkeep the runtime scheduled on the concept graph",
  };
}

function name(concepts: Concept[], id: string): string {
  return concepts.find((c) => c.id === id)?.name ?? id;
}

export function buildLineage(args: {
  cohortName: string;
  syllabusId: string;
  conceptId: string;
  concepts: Concept[];
  dependencies: Dependency[];
}): LineageNode[] {
  const { cohortName, syllabusId, conceptId, concepts, dependencies } = args;
  const conceptLabel = name(concepts, conceptId);
  const downstream = unlocks(dependencies, conceptId).map((id) => name(concepts, id));
  const serves = servesTrace(dependencies, concepts, conceptId);

  const nodes: LineageNode[] = [
    {
      id: "cohort",
      label: `cohort ${cohortName}`,
      detail: "your enrolment scope",
      kind: "binding",
    },
    {
      id: "syllabus",
      label: `syllabus “${BOUND_SYLLABUS_TITLE}”`,
      detail: `${syllabusId.slice(0, 8)} · authored by your trainer · adaptation_mode GUIDED · via SyllabusBound`,
      kind: "binding",
    },
    {
      id: "concept",
      label: `this concept “${conceptLabel}”`,
      detail: downstream.length
        ? `${serves.note} — and gates ${downstream.join(", ")}`
        : serves.note,
      kind: "trace",
    },
    {
      id: "outcome",
      label: serves.kind === "objective" ? "the outcome it serves" : "where it sits in the syllabus",
      detail:
        serves.kind === "objective"
          ? `${serves.pill} → “${BOUND_OUTCOME}”`
          : serves.pill,
      kind: "trace",
    },
    {
      id: "runtime",
      label: "the runtime planned this step",
      detail:
        "planned on the concept graph by weighing mastery, retention and active misconceptions — runtime decided",
      kind: "trace",
    },
    {
      id: "content",
      label: "the content is instruction-only / runtime-authored",
      detail: "the LLM, when active, only fills content — never the path",
      kind: "trace",
    },
  ];
  return nodes;
}
