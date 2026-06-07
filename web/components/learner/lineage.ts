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
  "écrit un handler qui persiste dans une transaction et annule en cas d'erreur";

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
      pill: `objectif · ${conceptId}`,
      note:
        conceptId === "persistence"
          ? `l'acquis : « ${BOUND_OUTCOME} »`
          : isFinal
            ? "l'objectif final du syllabus ; conditionné par la persistance"
            : "un objectif du syllabus",
    };
  }
  // Does any objective depend (transitively, one hop) on this concept?
  const feedsObjective = unlocks(deps, conceptId).some((c) => SYLLABUS_OBJECTIVES.has(c));
  if (feedsObjective) {
    return {
      kind: "prerequisite",
      pill: "prérequis ajouté par le runtime",
      note: "pas un objectif du syllabus ; le runtime l'a planifié pour soutenir la persistance",
    };
  }
  return {
    kind: "retention",
    pill: "hors objectifs du syllabus",
    note: "conservé pour l'entretien de la rétention que le runtime a planifié sur le graphe de concepts",
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
      label: `groupe ${cohortName}`,
      detail: "votre périmètre d'inscription",
      kind: "binding",
    },
    {
      id: "syllabus",
      label: `syllabus « ${BOUND_SYLLABUS_TITLE} »`,
      detail: `${syllabusId.slice(0, 8)} · rédigé par votre formateur · adaptation_mode GUIDED · via SyllabusBound`,
      kind: "binding",
    },
    {
      id: "concept",
      label: `ce concept « ${conceptLabel} »`,
      detail: downstream.length
        ? `${serves.note} — et conditionne ${downstream.join(", ")}`
        : serves.note,
      kind: "trace",
    },
    {
      id: "outcome",
      label: serves.kind === "objective" ? "l'acquis qu'il sert" : "sa place dans le syllabus",
      detail:
        serves.kind === "objective"
          ? `${serves.pill} → « ${BOUND_OUTCOME} »`
          : serves.pill,
      kind: "trace",
    },
    {
      id: "runtime",
      label: "le runtime a planifié cette étape",
      detail:
        "planifié sur le graphe de concepts en pondérant maîtrise, rétention et conceptions erronées actives — décidé par le runtime",
      kind: "trace",
    },
    {
      id: "content",
      label: "le contenu est en instruction seule / rédigé par le runtime",
      detail: "le LLM, lorsqu'il est actif, ne fait que remplir le contenu — jamais le parcours",
      kind: "trace",
    },
  ];
  return nodes;
}
