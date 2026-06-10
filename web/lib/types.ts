// Backend DTOs (mirrors internal/core/types.go). Server + client safe (types only).

export type Role = "SUPER_ADMIN" | "TENANT_ADMIN" | "TRAINER" | "GESTIONNAIRE" | "LEARNER";
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
// review_* (B-16) : curation par le formateur — un contenu REJECTED disparaît
// des lectures persistées.
export type ReviewStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED";
export interface GeneratedContent {
  tenant_id: string; id: string; instruction_id: string; provider: string; model: string; content: string; created_at: string;
  review_status?: ReviewStatus; reviewed_by?: string; reviewed_at?: string | null; review_note?: string;
}
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

// --- Vague D « Conformité OF » (B-08/B-10/B-11/B-14/B-15/B-28) --------------
// Mirrors internal/core/types.go — field names are the backend JSON keys.

// B-08 — profil légal de l'organisme (clés libres du JSON profile).
export interface TenantProfile {
  tenant_id: string;
  name: string;
  profile: Record<string, unknown>;
}

// B-10 — document contractuel versionné (append-only via root_id).
export type OFDocumentKind = "CONVENTION" | "CONTRAT" | "DEVIS" | "PROGRAMME" | "REGLEMENT_INTERIEUR" | "AUTRE";
export interface OFDocument {
  tenant_id: string;
  id: string;
  root_id: string;
  version: number;
  kind: OFDocumentKind;
  title: string;
  body?: string;
  cohort_id?: string;
  learner_id?: string;
  created_by?: string;
  created_at: string;
  archived_at?: string | null;
}

// B-11 — enquêtes de satisfaction (à chaud HOT / à froid COLD).
export interface SurveyQuestion {
  id: string;
  prompt: string;
  kind: "scale" | "text";
}
export interface SatisfactionSurvey {
  tenant_id: string;
  id: string;
  cohort_id: string;
  kind: "HOT" | "COLD";
  title: string;
  questions: SurveyQuestion[];
  opens_at?: string | null;
  closes_at?: string | null;
  created_by?: string;
  created_at: string;
  archived_at?: string | null;
}
export interface SurveyResponse {
  tenant_id: string;
  id: string;
  survey_id: string;
  learner_id: string;
  answers: Record<string, number | string>;
  submitted_at: string;
}

// B-11 — registre des réclamations (workflow RNQ).
export type ComplaintStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
export interface Complaint {
  tenant_id: string;
  id: string;
  opened_by?: string;
  learner_id?: string;
  subject: string;
  description?: string;
  status: ComplaintStatus;
  resolution?: string;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
}

// B-15 — dossier de financement (source administrative du BPF).
export type FunderType = "CPF" | "OPCO" | "FRANCE_TRAVAIL" | "EMPLOYEUR" | "AUTOFINANCEMENT" | "AUTRE";
export type FundingStatus = "EN_INSTRUCTION" | "ACCEPTE" | "REFUSE" | "SOLDE";
export interface FundingFile {
  tenant_id: string;
  id: string;
  learner_id: string;
  cohort_id?: string;
  funder_type: FunderType;
  funder_name?: string;
  reference?: string;
  status: FundingStatus;
  amount_cents: number;
  notes?: string;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
}
export interface BPFFunderLine {
  funder_type: string;
  files: number;
  learners: number;
  amount_cents: number;
}
export interface BPFReport {
  year: number;
  total_learners: number;
  total_trained_hours: number;
  total_amount_cents: number;
  by_funder: BPFFunderLine[];
}

// B-28 — textes légaux versionnés + consentements.
export type LegalTextKind = "CGU" | "CONFIDENTIALITE" | "MENTIONS";
export interface LegalText {
  tenant_id: string;
  id: string;
  kind: LegalTextKind;
  version: number;
  body: string;
  published_by?: string;
  published_at: string;
}
export interface Consent {
  tenant_id: string;
  id: string;
  user_id: string;
  legal_text_id: string;
  kind: string;
  version: number;
  consented_at: string;
}

// B-17 — support pédagogique : fichier (stocké en base, téléchargé via
// /download) ou lien externe ; cohort_id vide = visible du tenant entier.
export interface Resource {
  tenant_id: string;
  id: string;
  cohort_id?: string;
  title: string;
  description?: string;
  kind: "FICHIER" | "LIEN";
  url?: string;
  file_name?: string;
  mime_type?: string;
  size_bytes: number;
  uploaded_by?: string;
  created_at: string;
  archived_at?: string | null;
}

// B-18 — annonce du formateur/admin vers une cohorte (ou tout le tenant).
export interface Announcement {
  tenant_id: string;
  id: string;
  cohort_id?: string;
  title: string;
  body?: string;
  created_by?: string;
  created_at: string;
  archived_at?: string | null;
}

// Demo identities for the login/role entry (role is "derived" after sign-in).
export interface Identity { email: string; name: string; role: Role; learnerId?: string; }
