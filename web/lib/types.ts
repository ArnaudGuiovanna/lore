// Backend DTOs (mirrors internal/core/types.go). Server + client safe (types only).

export type Role = "SUPER_ADMIN" | "TENANT_ADMIN" | "TRAINER" | "LEARNER";
export type Phase = "DIAGNOSTIC" | "INSTRUCTION" | "MAINTENANCE";
export type ActivityType =
  | "EXPLANATION" | "SOCRATIC_DIALOGUE" | "GUIDED_PRACTICE" | "FREE_PRACTICE"
  | "REVIEW" | "ASSESSMENT" | "REFLECTION" | "TRANSFER" | "PROJECT" | "SIMULATION"
  | "SETUP_DOMAIN" | "REST" | "CLOSE_SESSION" | "DEBUG_MISCONCEPTION";
export type ActivityStatus = "PLANNED" | "STARTED" | "COMPLETED";
export type ReviewCardState = "new" | "learning" | "review" | "relearning";

export interface Tenant { id: string; parent_id?: string; name: string; slug: string; status: string; created_at: string; }
export interface User { id: string; email: string; name: string; status: string; created_at: string; }
export interface Membership { tenant_id: string; user_id: string; role: Role; status: string; created_at: string; }
export interface Learner {
  tenant_id: string;
  user_id: string;
  email: string;
  name: string;
  user_status: string;
  membership_status: string;
  user_created_at: string;
  membership_created_at: string;
}
export interface Program { tenant_id: string; id: string; name: string; created_at: string; }
export interface Cohort { tenant_id: string; id: string; program_id: string; name: string; start_date: string; end_date: string; created_at: string; }
export interface CohortEnrollment { tenant_id: string; cohort_id: string; learner_id: string; status: string; created_at: string; }
export interface TrainingSession {
  tenant_id: string; id: string; cohort_id: string; program_id?: string; title: string;
  starts_at: string; ends_at: string; capacity: number; location?: string; video_url?: string;
  status: string; created_at: string; updated_at: string; archived_at?: string | null;
}

export interface Syllabus { tenant_id: string; id: string; title: string; description: string; objectives?: Record<string, unknown>; outcomes?: Record<string, unknown>; created_at: string; }

// B-24 — editorial course modules a trainer lays over the adaptive runtime.
export interface CourseModule {
  tenant_id: string;
  id: string;
  syllabus_id: string;
  title: string;
  description?: string;
  position: number;
  concept_ids: string[];
  prerequisite_ids: string[];
  required_mastery: number;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
}
export type ModuleStatus = "LOCKED" | "AVAILABLE" | "IN_PROGRESS" | "COMPLETED";
// Learner-facing status of one module in their path (evidence-based, runtime-owned).
export interface ModuleProgress {
  module: CourseModule;
  status: ModuleStatus;
  concepts_total: number;
  concepts_mastered: number;
  avg_mastery: number;
}
export interface SyllabusBinding { tenant_id: string; id: string; syllabus_id: string; target_type: string; target_id: string; adaptation_mode: string; created_at: string; }

export interface Domain { tenant_id: string; id: string; owner_id: string; name: string; description: string; source: string; graph_version: number; status: string; phase: Phase; created_at: string; updated_at: string; }
export interface Concept { tenant_id: string; id: string; domain_id: string; name: string; description: string; difficulty: number; created_at: string; }
export interface Dependency { tenant_id: string; domain_id: string; parent_concept_id: string; child_concept_id: string; }
export interface DomainGraph { domain: Domain; concepts: Concept[]; dependencies: Dependency[]; }

export interface LearnerState {
  tenant_id: string; learner_id: string; domain_id: string; concept_id: string;
  mastery: number; retention: number; confidence: number; ability: number;
  p_learn: number; p_forget: number; p_slip: number; p_guess: number;
  stability: number; difficulty: number; reps: number; lapses: number;
  card_state: ReviewCardState; due_at?: string | null; last_interaction_at?: string | null; updated_at: string;
}
export interface ReviewCard {
  tenant_id: string; learner_id: string; domain_id: string; concept_id: string;
  due_at: string; stability: number; difficulty: number; reps: number; lapses: number;
  state: ReviewCardState; retention: number;
}
export interface Activity {
  tenant_id: string; id: string; learner_id: string; domain_id: string; concept_id: string;
  activity_type: ActivityType; difficulty_target: number; status: ActivityStatus;
  instruction_id: string; audit_rationale: string; created_at: string; started_at?: string | null; completed_at?: string | null;
  paused_seconds?: number; paused_at?: string | null;
}
export interface TutorInstruction {
  id: string; tenant_id: string; learner_id: string; domain_id: string; concept_id?: string; activity_id: string;
  activity_type: ActivityType; difficulty_target: number; constraints: string[]; allowed_variants: string[];
  context: Record<string, unknown>; created_at: string;
}
export interface GeneratedContent { tenant_id: string; id: string; instruction_id: string; provider: string; model: string; content: string; created_at: string; }
export interface AssessmentChoice { id: string; label: string; }
export interface AssessmentItem { id: string; kind: string; concept_id?: string; prompt: string; choices?: AssessmentChoice[]; points: number; }
export interface AssessmentAnswer { item_id: string; choice_id?: string; answer?: string; }
export interface LLMConfiguration {
  tenant_id: string; scope_type?: string; scope_id?: string; provider: string; model: string;
  base_url?: string; api_key_configured?: boolean; temperature?: number; max_tokens?: number; created_at: string; updated_at: string;
}
export interface Interaction { tenant_id: string; id: string; learner_id: string; activity_id: string; domain_id: string; concept_id: string; success: boolean; score: number; error_type?: string; payload?: Record<string, unknown>; created_at: string; }
export interface Misconception { tenant_id: string; id: string; learner_id: string; concept_id: string; description: string; severity: number; status: string; created_at: string; }
export interface PedagogicalSnapshot {
  tenant_id: string; id: string; interaction_id?: string; activity_id?: string; learner_id: string; domain_id: string; concept_id?: string;
  before?: Record<string, unknown>; observation?: Record<string, unknown>; after?: Record<string, unknown>; decision: Record<string, unknown>; created_at: string;
}
export interface Alert {
  tenant_id: string; id: string; learner_id: string; concept_id?: string; alert_type: string; severity: string; status: string;
  payload?: Record<string, unknown>; recommended_action: string; created_at: string; updated_at: string;
}
export interface LoreEvent {
  tenant_id: string; id: string; schema_version: number; actor_user_id: string; correlation_id: string; causation_id: string;
  event_type: string; aggregate_type?: string; aggregate_id?: string; payload?: Record<string, unknown>; published?: boolean; created_at: string;
}

// Response wrappers seen from the backend.
export interface PlanNextResponse {
  activity: Activity;
  tutor_instruction?: TutorInstruction;
  instruction?: TutorInstruction;
  generated_content?: GeneratedContent;
  generated_content_error?: { status: number; error: string };
  state_delta?: unknown;
  [k: string]: unknown;
}

// B-23 — shareable self-enrollment invite for a cohort (admin-managed).
export interface CohortInvite {
  tenant_id: string;
  id: string;
  cohort_id: string;
  code: string;
  expires_at?: string | null;
  max_uses: number; // 0 = illimité
  use_count: number;
  created_by?: string;
  created_at: string;
  revoked_at?: string | null;
  tenant_name?: string;
  cohort_name?: string;
}

// Public lookup of an invite code (the /join landing read).
export interface InviteLookup {
  tenant_id: string;
  tenant_name: string;
  cohort_id: string;
  cohort_name: string;
  usable: boolean;
  reason: string;
}

// B-26 — banque de questions (formateur). Keys (correct choice / expected
// answer) only ever transit on staff surfaces.
export interface BankQuestion {
  tenant_id: string;
  id: string;
  concept_id?: string;
  kind: "single_choice" | "short_answer";
  prompt: string;
  choices?: AssessmentChoice[];
  correct_choice_id?: string;
  expected_answer?: string;
  points: number;
  created_by?: string;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
}

// B-26 — devoir d'une cohorte ; si domain_id/concept_id sont posés, la note
// manuelle alimente le moteur adaptatif comme évidence corrigée.
export interface Assignment {
  tenant_id: string;
  id: string;
  cohort_id: string;
  domain_id?: string;
  concept_id?: string;
  title: string;
  description?: string;
  due_at?: string | null;
  created_by?: string;
  created_at: string;
  archived_at?: string | null;
}

export interface AssignmentSubmission {
  tenant_id: string;
  id: string;
  assignment_id: string;
  learner_id: string;
  content: string;
  submitted_at: string;
  score?: number | null; // 0..1, posé par la correction manuelle
  feedback?: string;
  graded_by?: string;
  graded_at?: string | null;
}

// Demo identities for the login/role entry (role is "derived" after sign-in).
export interface Identity { email: string; name: string; role: Role; learnerId?: string; }
