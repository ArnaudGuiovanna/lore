// Admin-surface shared prop types. Real, backend-derived shapes only.
import type { Concept, Dependency, LLMConfiguration, Role } from "@/lib/types";

// One membership row in the identity matrix. Role is derived from membership,
// never requested by the client. `userId` is the LORE user id (present when the
// row is backed by a real membership/credential — required to re-grant a role).
export interface MembershipRow {
  name: string;
  email: string;
  role: Role;
  scope: string;
  status: string;
  self?: boolean;
  userId?: string;
  manageable?: boolean; // false for SUPER_ADMIN / the acting admin themselves
}

// A program (live, from the backend / outbox) plus its cohorts, for the org
// management surface.
export interface ManagedCohort {
  id: string;
  name: string;
  programId: string;
}
export interface ManagedProgram {
  id: string;
  name: string;
  cohorts: ManagedCohort[];
}

// One roster row for a cohort: an enrolled learner + their live runtime state
// (average mastery / due reviews) where the runtime has answered.
export interface RosterRow {
  learnerId: string;
  name: string;
  enrolled: boolean;
  avgMastery: number | null; // null => runtime has no state yet
  concepts: number;
  dueReviews: number | null;
}

// A learner that can be enrolled (from the tenant's seeded/known learners).
export interface EnrollableLearner {
  id: string;
  name: string;
}

// A node in the org-structure tree: program › cohort › enrollment, plus the
// read-only syllabus binding the admin may only observe.
export interface EnrollmentMember {
  name: string;
  role: "TRAINER" | "LEARNER";
  lead?: boolean;
}
export interface BoundSyllabus {
  title: string;
  syllabusId: string;
  targetType: string;
  targetId: string;
  adaptationMode: string;
  author: string;
  domainName: string;
}
export interface CohortNode {
  id: string;
  name: string;
  leadName: string;
  enrollment: EnrollmentMember[];
  extraLearners: number;
  bound: BoundSyllabus[];
}
export interface ProgramNode {
  id: string;
  name: string;
  cohorts: CohortNode[];
}

// One row of the LLM configuration matrix. `config` is the explicit config set at
// this scope (zero-value created_at => not actually set / inherited).
export type ScopeTier = "tenant" | "program" | "cohort" | "learner";
export interface ScopeRow {
  tier: ScopeTier;
  scopeId: string; // backend scope_id ("" for tenant)
  label: string;
  hint?: string; // e.g. learner-1 slug
  config: LLMConfiguration | null; // null => inherits
  editable: boolean;
}

// A normalized outbox event (backend uses occurred_at, no published flag).
export interface OutboxEvent {
  id: string;
  eventType: string;
  aggregateType?: string;
  aggregateId?: string;
  occurredAt: string;
  published: boolean;
  payload?: Record<string, unknown>;
  annotation?: string;
}

export interface DomainGraphData {
  domainName: string;
  domainId: string;
  graphVersion: number;
  concepts: Concept[];
  dependencies: Dependency[];
}
