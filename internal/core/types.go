package core

import (
	"errors"
	"time"
)

var (
	ErrNotFound       = errors.New("not found")
	ErrInvalidInput   = errors.New("invalid input")
	ErrTenantMismatch = errors.New("tenant mismatch")
	ErrConflict       = errors.New("conflict")
)

type Role string

const (
	RoleSuperAdmin  Role = "SUPER_ADMIN"
	RoleTenantAdmin Role = "TENANT_ADMIN"
	RoleTrainer     Role = "TRAINER"
	RoleLearner     Role = "LEARNER"
	// RoleManager (B-27): gestionnaire administratif — inscriptions, sessions,
	// documents, financement, qualité ; jamais la configuration technique ni
	// la conception pédagogique.
	RoleManager Role = "GESTIONNAIRE"
)

// Valid reports whether r is one of the recognized membership roles.
func (r Role) Valid() bool {
	switch r {
	case RoleSuperAdmin, RoleTenantAdmin, RoleTrainer, RoleLearner, RoleManager:
		return true
	default:
		return false
	}
}

type Phase string

const (
	PhaseDiagnostic  Phase = "DIAGNOSTIC"
	PhaseInstruction Phase = "INSTRUCTION"
	PhaseMaintenance Phase = "MAINTENANCE"
)

type ActivityType string

const (
	ActivityExplanation    ActivityType = "EXPLANATION"
	ActivitySocraticDialog ActivityType = "SOCRATIC_DIALOGUE"
	ActivityGuidedPractice ActivityType = "GUIDED_PRACTICE"
	ActivityFreePractice   ActivityType = "FREE_PRACTICE"
	ActivityReview         ActivityType = "REVIEW"
	ActivityAssessment     ActivityType = "ASSESSMENT"
	ActivityReflection     ActivityType = "REFLECTION"
	ActivityTransfer       ActivityType = "TRANSFER"
	ActivityProject        ActivityType = "PROJECT"
	ActivitySimulation     ActivityType = "SIMULATION"
	ActivitySetupDomain    ActivityType = "SETUP_DOMAIN"
	ActivityRest           ActivityType = "REST"
	ActivityCloseSession   ActivityType = "CLOSE_SESSION"
	ActivityMisconception  ActivityType = "DEBUG_MISCONCEPTION"
)

type ActivityStatus string

const (
	ActivityPlanned   ActivityStatus = "PLANNED"
	ActivityStarted   ActivityStatus = "STARTED"
	ActivityCompleted ActivityStatus = "COMPLETED"
)

type ReviewCardState string

const (
	ReviewNew        ReviewCardState = "new"
	ReviewLearning   ReviewCardState = "learning"
	ReviewReview     ReviewCardState = "review"
	ReviewRelearning ReviewCardState = "relearning"
)

type Tenant struct {
	ID        string    `json:"id"`
	ParentID  string    `json:"parent_id,omitempty"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	// Profile (B-09/B-10): legal identity of the organisme de formation —
	// raison sociale, SIRET, NDA, adresse, signataire… One canonical source
	// for attestation/convention generators. Free-form by design.
	Profile map[string]any `json:"profile,omitempty"`
}

type User struct {
	ID         string     `json:"id"`
	Email      string     `json:"email"`
	Name       string     `json:"name"`
	Status     string     `json:"status"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	ArchivedAt *time.Time `json:"archived_at,omitempty"`
}

type Membership struct {
	TenantID   string     `json:"tenant_id"`
	UserID     string     `json:"user_id"`
	Role       Role       `json:"role"`
	Status     string     `json:"status"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	ArchivedAt *time.Time `json:"archived_at,omitempty"`
}

type Learner struct {
	TenantID            string    `json:"tenant_id"`
	UserID              string    `json:"user_id"`
	Email               string    `json:"email"`
	Name                string    `json:"name"`
	UserStatus          string    `json:"user_status"`
	MembershipStatus    string    `json:"membership_status"`
	UserCreatedAt       time.Time `json:"user_created_at"`
	MembershipCreatedAt time.Time `json:"membership_created_at"`
}

type TenantUser struct {
	TenantID             string     `json:"tenant_id"`
	UserID               string     `json:"user_id"`
	Email                string     `json:"email"`
	Name                 string     `json:"name"`
	UserStatus           string     `json:"user_status"`
	Role                 Role       `json:"role"`
	MembershipStatus     string     `json:"membership_status"`
	UserCreatedAt        time.Time  `json:"user_created_at"`
	UserUpdatedAt        time.Time  `json:"user_updated_at"`
	UserArchivedAt       *time.Time `json:"user_archived_at,omitempty"`
	MembershipCreatedAt  time.Time  `json:"membership_created_at"`
	MembershipUpdatedAt  time.Time  `json:"membership_updated_at"`
	MembershipArchivedAt *time.Time `json:"membership_archived_at,omitempty"`
}

type Program struct {
	TenantID   string     `json:"tenant_id"`
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Status     string     `json:"status"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	ArchivedAt *time.Time `json:"archived_at,omitempty"`
}

type Cohort struct {
	TenantID   string     `json:"tenant_id"`
	ID         string     `json:"id"`
	ProgramID  string     `json:"program_id"`
	Name       string     `json:"name"`
	StartDate  time.Time  `json:"start_date"`
	EndDate    time.Time  `json:"end_date"`
	Status     string     `json:"status"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	ArchivedAt *time.Time `json:"archived_at,omitempty"`
}

type CohortEnrollment struct {
	TenantID   string     `json:"tenant_id"`
	CohortID   string     `json:"cohort_id"`
	LearnerID  string     `json:"learner_id"`
	Status     string     `json:"status"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	ArchivedAt *time.Time `json:"archived_at,omitempty"`
}

type TrainingSession struct {
	TenantID   string     `json:"tenant_id"`
	ID         string     `json:"id"`
	CohortID   string     `json:"cohort_id"`
	ProgramID  string     `json:"program_id,omitempty"`
	Title      string     `json:"title"`
	StartsAt   time.Time  `json:"starts_at"`
	EndsAt     time.Time  `json:"ends_at"`
	Capacity   int        `json:"capacity"`
	Location   string     `json:"location,omitempty"`
	VideoURL   string     `json:"video_url,omitempty"`
	Status     string     `json:"status"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	ArchivedAt *time.Time `json:"archived_at,omitempty"`
}

type TrainingSessionPatch struct {
	CohortID *string    `json:"cohort_id,omitempty"`
	Title    *string    `json:"title,omitempty"`
	StartsAt *time.Time `json:"starts_at,omitempty"`
	EndsAt   *time.Time `json:"ends_at,omitempty"`
	Capacity *int       `json:"capacity,omitempty"`
	Location *string    `json:"location,omitempty"`
	VideoURL *string    `json:"video_url,omitempty"`
	Status   *string    `json:"status,omitempty"`
}

type AdminAuditLog struct {
	TenantID    string         `json:"tenant_id"`
	ID          string         `json:"id"`
	ActorUserID string         `json:"actor_user_id,omitempty"`
	Action      string         `json:"action"`
	TargetType  string         `json:"target_type"`
	TargetID    string         `json:"target_id"`
	Payload     map[string]any `json:"payload,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
}

// OFDocument (B-10) — contractual document (convention, contrat, devis,
// programme, règlement intérieur). Versions are append-only via root_id.
type OFDocument struct {
	TenantID   string     `json:"tenant_id"`
	ID         string     `json:"id"`
	RootID     string     `json:"root_id"`
	Version    int        `json:"version"`
	Kind       string     `json:"kind"`
	Title      string     `json:"title"`
	Body       string     `json:"body,omitempty"`
	CohortID   string     `json:"cohort_id,omitempty"`
	LearnerID  string     `json:"learner_id,omitempty"`
	CreatedBy  string     `json:"created_by,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	ArchivedAt *time.Time `json:"archived_at,omitempty"`
}

// BankQuestion (B-26) — trainer-authored question. When questions exist for a
// concept, runtime assessments use them instead of the generated fallback;
// answer keys NEVER leave the backend (scoring fetches them at submit time).
type BankQuestion struct {
	TenantID        string             `json:"tenant_id"`
	ID              string             `json:"id"`
	ConceptID       string             `json:"concept_id,omitempty"`
	Kind            string             `json:"kind"` // single_choice | short_answer
	Prompt          string             `json:"prompt"`
	Choices         []AssessmentChoice `json:"choices,omitempty"`
	CorrectChoiceID string             `json:"correct_choice_id,omitempty"`
	ExpectedAnswer  string             `json:"expected_answer,omitempty"`
	Points          float64            `json:"points"`
	CreatedBy       string             `json:"created_by,omitempty"`
	CreatedAt       time.Time          `json:"created_at"`
	UpdatedAt       time.Time          `json:"updated_at"`
	ArchivedAt      *time.Time         `json:"archived_at,omitempty"`
}

// Assignment (B-26) — un devoir avec date limite ; si concept_id/domain_id
// sont posés, la note manuelle alimente le runtime (BKT) comme évidence.
type Assignment struct {
	TenantID    string     `json:"tenant_id"`
	ID          string     `json:"id"`
	CohortID    string     `json:"cohort_id"`
	DomainID    string     `json:"domain_id,omitempty"`
	ConceptID   string     `json:"concept_id,omitempty"`
	Title       string     `json:"title"`
	Description string     `json:"description,omitempty"`
	DueAt       *time.Time `json:"due_at,omitempty"`
	CreatedBy   string     `json:"created_by,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	ArchivedAt  *time.Time `json:"archived_at,omitempty"`
}

type AssignmentSubmission struct {
	TenantID     string     `json:"tenant_id"`
	ID           string     `json:"id"`
	AssignmentID string     `json:"assignment_id"`
	LearnerID    string     `json:"learner_id"`
	Content      string     `json:"content"`
	SubmittedAt  time.Time  `json:"submitted_at"`
	Score        *float64   `json:"score,omitempty"` // 0..1, set by manual grading
	Feedback     string     `json:"feedback,omitempty"`
	GradedBy     string     `json:"graded_by,omitempty"`
	GradedAt     *time.Time `json:"graded_at,omitempty"`
}

// SatisfactionSurvey (B-11) — à chaud (HOT) right after training, à froid
// (COLD) weeks later. Questions: [{id, prompt, kind: "scale"|"text"}].
type SatisfactionSurvey struct {
	TenantID   string           `json:"tenant_id"`
	ID         string           `json:"id"`
	CohortID   string           `json:"cohort_id"`
	Kind       string           `json:"kind"` // HOT | COLD
	Title      string           `json:"title"`
	Questions  []SurveyQuestion `json:"questions"`
	OpensAt    *time.Time       `json:"opens_at,omitempty"`
	ClosesAt   *time.Time       `json:"closes_at,omitempty"`
	CreatedBy  string           `json:"created_by,omitempty"`
	CreatedAt  time.Time        `json:"created_at"`
	ArchivedAt *time.Time       `json:"archived_at,omitempty"`
}

type SurveyQuestion struct {
	ID     string `json:"id"`
	Prompt string `json:"prompt"`
	Kind   string `json:"kind"` // scale (1..5) | text
}

type SurveyResponse struct {
	TenantID    string         `json:"tenant_id"`
	ID          string         `json:"id"`
	SurveyID    string         `json:"survey_id"`
	LearnerID   string         `json:"learner_id"`
	Answers     map[string]any `json:"answers"` // question id -> number|string
	SubmittedAt time.Time      `json:"submitted_at"`
}

// Complaint (B-11) — RNQ-required register entry with a processing workflow.
type Complaint struct {
	TenantID    string     `json:"tenant_id"`
	ID          string     `json:"id"`
	OpenedBy    string     `json:"opened_by,omitempty"`
	LearnerID   string     `json:"learner_id,omitempty"`
	Subject     string     `json:"subject"`
	Description string     `json:"description,omitempty"`
	Status      string     `json:"status"` // OPEN | IN_PROGRESS | RESOLVED | CLOSED
	Resolution  string     `json:"resolution,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	ClosedAt    *time.Time `json:"closed_at,omitempty"`
}

// CohortInvite (B-23) is a shareable self-enrollment code for a cohort. The
// code is the bearer secret; redemption is performed by the trusted web tier.
type CohortInvite struct {
	TenantID   string     `json:"tenant_id"`
	ID         string     `json:"id"`
	CohortID   string     `json:"cohort_id"`
	Code       string     `json:"code"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	MaxUses    int        `json:"max_uses"` // 0 = unlimited
	UseCount   int        `json:"use_count"`
	CreatedBy  string     `json:"created_by,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
	TenantName string     `json:"tenant_name,omitempty"` // lookup convenience
	CohortName string     `json:"cohort_name,omitempty"` // lookup convenience
}

// CourseModule (B-24) is an editorial sequencing unit a trainer lays over the
// adaptive runtime: an ordered group of domain concepts under a syllabus, with
// explicit prerequisites. Completion is evidence-based (runtime mastery).
type CourseModule struct {
	TenantID        string     `json:"tenant_id"`
	ID              string     `json:"id"`
	SyllabusID      string     `json:"syllabus_id"`
	Title           string     `json:"title"`
	Description     string     `json:"description,omitempty"`
	Position        int        `json:"position"`
	ConceptIDs      []string   `json:"concept_ids"`
	PrerequisiteIDs []string   `json:"prerequisite_ids"`
	RequiredMastery float64    `json:"required_mastery"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	ArchivedAt      *time.Time `json:"archived_at,omitempty"`
}

// CourseModulePatch carries optional updates for a module (nil = unchanged).
type CourseModulePatch struct {
	Title           *string   `json:"title,omitempty"`
	Description     *string   `json:"description,omitempty"`
	Position        *int      `json:"position,omitempty"`
	ConceptIDs      *[]string `json:"concept_ids,omitempty"`
	PrerequisiteIDs *[]string `json:"prerequisite_ids,omitempty"`
	RequiredMastery *float64  `json:"required_mastery,omitempty"`
}

// ModuleProgress is the learner-facing status of one module in their path.
type ModuleProgress struct {
	Module           CourseModule `json:"module"`
	Status           string       `json:"status"` // LOCKED | AVAILABLE | IN_PROGRESS | COMPLETED
	ConceptsTotal    int          `json:"concepts_total"`
	ConceptsMastered int          `json:"concepts_mastered"`
	AvgMastery       float64      `json:"avg_mastery"`
}

// LearnerProgressSummary is one row of the cohort progress export (B-12/B-22):
// runtime-owned evidence per learner, never client-computed.
type LearnerProgressSummary struct {
	TenantID            string  `json:"tenant_id"`
	CohortID            string  `json:"cohort_id"`
	LearnerID           string  `json:"learner_id"`
	ConceptsTracked     int     `json:"concepts_tracked"`
	ConceptsMastered    int     `json:"concepts_mastered"`
	AvgMastery          float64 `json:"avg_mastery"`
	AvgRetention        float64 `json:"avg_retention"`
	ActivityCount       int     `json:"activity_count"`
	TrainingTimeSeconds int64   `json:"training_time_seconds"`
	TrainingHours       float64 `json:"training_hours"`
}

type TrainingTimeSummary struct {
	TenantID            string  `json:"tenant_id"`
	ProgramID           string  `json:"program_id,omitempty"`
	CohortID            string  `json:"cohort_id"`
	LearnerID           string  `json:"learner_id"`
	ActivityCount       int     `json:"activity_count"`
	TrainingTimeSeconds int64   `json:"training_time_seconds"`
	TrainingHours       float64 `json:"training_hours"`
}

type Syllabus struct {
	TenantID    string         `json:"tenant_id"`
	ID          string         `json:"id"`
	Title       string         `json:"title"`
	Description string         `json:"description"`
	Objectives  map[string]any `json:"objectives,omitempty"`
	Outcomes    map[string]any `json:"outcomes,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
}

type SyllabusBinding struct {
	TenantID       string    `json:"tenant_id"`
	ID             string    `json:"id"`
	SyllabusID     string    `json:"syllabus_id"`
	TargetType     string    `json:"target_type"`
	TargetID       string    `json:"target_id"`
	AdaptationMode string    `json:"adaptation_mode"`
	CreatedAt      time.Time `json:"created_at"`
}

type Domain struct {
	TenantID     string    `json:"tenant_id"`
	ID           string    `json:"id"`
	OwnerID      string    `json:"owner_id"`
	Name         string    `json:"name"`
	Description  string    `json:"description"`
	Source       string    `json:"source"`
	GraphVersion int       `json:"graph_version"`
	Status       string    `json:"status"`
	Phase        Phase     `json:"phase"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type Concept struct {
	TenantID    string    `json:"tenant_id"`
	ID          string    `json:"id"`
	DomainID    string    `json:"domain_id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Difficulty  float64   `json:"difficulty"`
	CreatedAt   time.Time `json:"created_at"`
}

type Dependency struct {
	TenantID        string `json:"tenant_id"`
	DomainID        string `json:"domain_id"`
	ParentConceptID string `json:"parent_concept_id"`
	ChildConceptID  string `json:"child_concept_id"`
}

type DomainGraph struct {
	Domain       Domain       `json:"domain"`
	Concepts     []Concept    `json:"concepts"`
	Dependencies []Dependency `json:"dependencies"`
}

type ConceptDraft struct {
	ID          string  `json:"id,omitempty"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Difficulty  float64 `json:"difficulty"`
}

type DependencyDraft struct {
	ParentConceptID string `json:"parent_concept_id"`
	ChildConceptID  string `json:"child_concept_id"`
}

type LearnerState struct {
	TenantID          string          `json:"tenant_id"`
	LearnerID         string          `json:"learner_id"`
	DomainID          string          `json:"domain_id"`
	ConceptID         string          `json:"concept_id"`
	Mastery           float64         `json:"mastery"`
	Retention         float64         `json:"retention"`
	Confidence        float64         `json:"confidence"`
	Ability           float64         `json:"ability"`
	PLearn            float64         `json:"p_learn"`
	PForget           float64         `json:"p_forget"`
	PSlip             float64         `json:"p_slip"`
	PGuess            float64         `json:"p_guess"`
	Stability         float64         `json:"stability"`
	Difficulty        float64         `json:"difficulty"`
	Reps              int             `json:"reps"`
	Lapses            int             `json:"lapses"`
	CardState         ReviewCardState `json:"card_state"`
	DueAt             *time.Time      `json:"due_at,omitempty"`
	LastInteractionAt *time.Time      `json:"last_interaction_at,omitempty"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

type ReviewCard struct {
	TenantID   string          `json:"tenant_id"`
	LearnerID  string          `json:"learner_id"`
	DomainID   string          `json:"domain_id"`
	ConceptID  string          `json:"concept_id"`
	DueAt      time.Time       `json:"due_at"`
	Stability  float64         `json:"stability"`
	Difficulty float64         `json:"difficulty"`
	Reps       int             `json:"reps"`
	Lapses     int             `json:"lapses"`
	State      ReviewCardState `json:"state"`
	Retention  float64         `json:"retention"`
}

type Activity struct {
	TenantID         string         `json:"tenant_id"`
	ID               string         `json:"id"`
	LearnerID        string         `json:"learner_id"`
	DomainID         string         `json:"domain_id"`
	ConceptID        string         `json:"concept_id"`
	ActivityType     ActivityType   `json:"activity_type"`
	DifficultyTarget float64        `json:"difficulty_target"`
	Status           ActivityStatus `json:"status"`
	InstructionID    string         `json:"instruction_id"`
	AuditRationale   string         `json:"audit_rationale"`
	CreatedAt        time.Time      `json:"created_at"`
	StartedAt        *time.Time     `json:"started_at,omitempty"`
	CompletedAt      *time.Time     `json:"completed_at,omitempty"`
	// Pause accounting (B-07): paused_seconds accumulates closed pause intervals;
	// paused_at is set while a pause is open. Training time = completed-started
	// minus paused_seconds, capped.
	PausedSeconds int64      `json:"paused_seconds,omitempty"`
	PausedAt      *time.Time `json:"paused_at,omitempty"`
}

type TutorInstruction struct {
	ID               string         `json:"id"`
	TenantID         string         `json:"tenant_id"`
	LearnerID        string         `json:"learner_id"`
	DomainID         string         `json:"domain_id"`
	ConceptID        string         `json:"concept_id,omitempty"`
	ActivityID       string         `json:"activity_id"`
	ActivityType     ActivityType   `json:"activity_type"`
	DifficultyTarget float64        `json:"difficulty_target"`
	Constraints      []string       `json:"constraints"`
	AllowedVariants  []string       `json:"allowed_variants"`
	Context          map[string]any `json:"context"`
	CreatedAt        time.Time      `json:"created_at"`
}

type GeneratedContent struct {
	TenantID      string    `json:"tenant_id"`
	ID            string    `json:"id"`
	InstructionID string    `json:"instruction_id"`
	Provider      string    `json:"provider"`
	Model         string    `json:"model"`
	Content       string    `json:"content"`
	CreatedAt     time.Time `json:"created_at"`
	// Curation (B-16): trainers review what was taught. REJECTED content is
	// no longer served from persistence-backed reads.
	ReviewStatus string     `json:"review_status,omitempty"` // PENDING_REVIEW | APPROVED | REJECTED
	ReviewedBy   string     `json:"reviewed_by,omitempty"`
	ReviewedAt   *time.Time `json:"reviewed_at,omitempty"`
	ReviewNote   string     `json:"review_note,omitempty"`
}

// Announcement (B-18) — message du formateur/admin vers une cohorte (ou tout
// le tenant quand cohort_id est vide).
type Announcement struct {
	TenantID   string     `json:"tenant_id"`
	ID         string     `json:"id"`
	CohortID   string     `json:"cohort_id,omitempty"`
	Title      string     `json:"title"`
	Body       string     `json:"body,omitempty"`
	CreatedBy  string     `json:"created_by,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	ArchivedAt *time.Time `json:"archived_at,omitempty"`
}

// FundingFile (B-15) — dossier de financement d'un apprenant : qui paie quoi
// (CPF, OPCO, France Travail, employeur...), sous quelle référence et pour
// quel montant. C'est la donnée administrative source du BPF.
type FundingFile struct {
	TenantID    string     `json:"tenant_id"`
	ID          string     `json:"id"`
	LearnerID   string     `json:"learner_id"`
	CohortID    string     `json:"cohort_id,omitempty"`
	FunderType  string     `json:"funder_type"` // CPF | OPCO | FRANCE_TRAVAIL | EMPLOYEUR | AUTOFINANCEMENT | AUTRE
	FunderName  string     `json:"funder_name,omitempty"`
	Reference   string     `json:"reference,omitempty"` // n° dossier EDOF/OPCO...
	Status      string     `json:"status"`              // EN_INSTRUCTION | ACCEPTE | REFUSE | SOLDE
	AmountCents int64      `json:"amount_cents"`
	Notes       string     `json:"notes,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	ArchivedAt  *time.Time `json:"archived_at,omitempty"`
}

type FundingFilePatch struct {
	FunderType  *string `json:"funder_type,omitempty"`
	FunderName  *string `json:"funder_name,omitempty"`
	Reference   *string `json:"reference,omitempty"`
	Status      *string `json:"status,omitempty"`
	AmountCents *int64  `json:"amount_cents,omitempty"`
	Notes       *string `json:"notes,omitempty"`
	CohortID    *string `json:"cohort_id,omitempty"`
}

// BPFReport (B-15) — agrégat annuel minimal pour préparer le Bilan
// Pédagogique et Financier : produits par origine de financement (cadre C)
// et volume stagiaires/heures (cadre F).
type BPFReport struct {
	Year              int             `json:"year"`
	TotalLearners     int             `json:"total_learners"`
	TotalTrainedHours float64         `json:"total_trained_hours"`
	TotalAmountCents  int64           `json:"total_amount_cents"`
	ByFunder          []BPFFunderLine `json:"by_funder"`
}

type BPFFunderLine struct {
	FunderType  string `json:"funder_type"`
	Files       int    `json:"files"`
	Learners    int    `json:"learners"`
	AmountCents int64  `json:"amount_cents"`
}

// LegalText (B-28) — texte légal versionné par tenant. Publier remplace la
// version courante (version = max+1) sans effacer l'historique : chaque
// consentement pointe la version exacte acceptée.
type LegalText struct {
	TenantID    string    `json:"tenant_id"`
	ID          string    `json:"id"`
	Kind        string    `json:"kind"` // CGU | CONFIDENTIALITE | MENTIONS
	Version     int       `json:"version"`
	Body        string    `json:"body"`
	PublishedBy string    `json:"published_by,omitempty"`
	PublishedAt time.Time `json:"published_at"`
}

type Consent struct {
	TenantID    string    `json:"tenant_id"`
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	LegalTextID string    `json:"legal_text_id"`
	Kind        string    `json:"kind"`
	Version     int       `json:"version"`
	ConsentedAt time.Time `json:"consented_at"`
}

type LLMConfiguration struct {
	TenantID         string    `json:"tenant_id"`
	ScopeType        string    `json:"scope_type,omitempty"`
	ScopeID          string    `json:"scope_id,omitempty"`
	Provider         string    `json:"provider"`
	Model            string    `json:"model"`
	BaseURL          string    `json:"base_url,omitempty"`
	APIKey           string    `json:"api_key,omitempty"`
	APIKeyConfigured bool      `json:"api_key_configured,omitempty"`
	Temperature      float64   `json:"temperature,omitempty"`
	MaxTokens        int       `json:"max_tokens,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type Interaction struct {
	TenantID   string         `json:"tenant_id"`
	ID         string         `json:"id"`
	LearnerID  string         `json:"learner_id"`
	ActivityID string         `json:"activity_id"`
	DomainID   string         `json:"domain_id"`
	ConceptID  string         `json:"concept_id"`
	Success    bool           `json:"success"`
	Score      float64        `json:"score"`
	ErrorType  string         `json:"error_type,omitempty"`
	Payload    map[string]any `json:"payload,omitempty"`
	CreatedAt  time.Time      `json:"created_at"`
}

type Evaluation struct {
	TenantID      string         `json:"tenant_id"`
	ID            string         `json:"id"`
	InteractionID string         `json:"interaction_id"`
	Score         float64        `json:"score"`
	Feedback      string         `json:"feedback"`
	Rubric        map[string]any `json:"rubric,omitempty"`
	CreatedAt     time.Time      `json:"created_at"`
}

type AssessmentChoice struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type AssessmentItem struct {
	ID        string             `json:"id"`
	Kind      string             `json:"kind"`
	ConceptID string             `json:"concept_id,omitempty"`
	Prompt    string             `json:"prompt"`
	Choices   []AssessmentChoice `json:"choices,omitempty"`
	Points    float64            `json:"points"`
}

type AssessmentAnswer struct {
	ItemID   string `json:"item_id"`
	ChoiceID string `json:"choice_id,omitempty"`
	Answer   string `json:"answer,omitempty"`
}

type AssessmentCorrection struct {
	ItemID           string  `json:"item_id"`
	ExpectedChoiceID string  `json:"expected_choice_id,omitempty"`
	GivenChoiceID    string  `json:"given_choice_id,omitempty"`
	GivenAnswer      string  `json:"given_answer,omitempty"`
	Correct          bool    `json:"correct"`
	PointsAwarded    float64 `json:"points_awarded"`
	PointsPossible   float64 `json:"points_possible"`
}

type Misconception struct {
	TenantID    string    `json:"tenant_id"`
	ID          string    `json:"id"`
	LearnerID   string    `json:"learner_id"`
	ConceptID   string    `json:"concept_id"`
	Description string    `json:"description"`
	Severity    float64   `json:"severity"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
}

type PedagogicalSnapshot struct {
	TenantID      string         `json:"tenant_id"`
	ID            string         `json:"id"`
	InteractionID string         `json:"interaction_id,omitempty"`
	ActivityID    string         `json:"activity_id,omitempty"`
	LearnerID     string         `json:"learner_id"`
	DomainID      string         `json:"domain_id"`
	ConceptID     string         `json:"concept_id,omitempty"`
	Before        map[string]any `json:"before,omitempty"`
	Observation   map[string]any `json:"observation,omitempty"`
	After         map[string]any `json:"after,omitempty"`
	Decision      map[string]any `json:"decision"`
	CreatedAt     time.Time      `json:"created_at"`
}

type Alert struct {
	TenantID          string         `json:"tenant_id"`
	ID                string         `json:"id"`
	LearnerID         string         `json:"learner_id"`
	ConceptID         string         `json:"concept_id,omitempty"`
	AlertType         string         `json:"alert_type"`
	Severity          string         `json:"severity"`
	Status            string         `json:"status"`
	Payload           map[string]any `json:"payload,omitempty"`
	RecommendedAction string         `json:"recommended_action"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
}

type Event struct {
	TenantID      string         `json:"tenant_id"`
	ID            string         `json:"id"`
	SchemaVersion int            `json:"schema_version"`
	ActorUserID   string         `json:"actor_user_id"`
	CorrelationID string         `json:"correlation_id"`
	CausationID   string         `json:"causation_id"`
	EventType     string         `json:"event_type"`
	AggregateType string         `json:"aggregate_type"`
	AggregateID   string         `json:"aggregate_id"`
	Payload       map[string]any `json:"payload,omitempty"`
	OccurredAt    time.Time      `json:"occurred_at"`
	PublishedAt   *time.Time     `json:"published_at,omitempty"`
}

type IdempotencyRecord struct {
	TenantID   string    `json:"tenant_id"`
	Key        string    `json:"key"`
	StatusCode int       `json:"status_code"`
	Response   []byte    `json:"-"`
	CreatedAt  time.Time `json:"created_at"`
}

type RuntimeDecision struct {
	DecisionID       string              `json:"decision_id"`
	Activity         Activity            `json:"activity"`
	TutorInstruction TutorInstruction    `json:"tutor_instruction"`
	GeneratedContent *GeneratedContent   `json:"generated_content,omitempty"`
	Snapshot         PedagogicalSnapshot `json:"snapshot"`
}

type InteractionCommand struct {
	TenantID   string         `json:"tenant_id"`
	LearnerID  string         `json:"learner_id"`
	ActivityID string         `json:"activity_id"`
	Success    bool           `json:"success"`
	Score      float64        `json:"score"`
	ErrorType  string         `json:"error_type,omitempty"`
	Feedback   string         `json:"feedback,omitempty"`
	Payload    map[string]any `json:"payload,omitempty"`
}

type AssessmentSubmissionCommand struct {
	TenantID            string             `json:"tenant_id"`
	LearnerID           string             `json:"learner_id"`
	ActivityID          string             `json:"activity_id"`
	Answers             []AssessmentAnswer `json:"answers"`
	SelfReportedSuccess *bool              `json:"success,omitempty"`
	SelfReportedScore   *float64           `json:"score,omitempty"`
	Confidence          *float64           `json:"confidence,omitempty"`
	Feedback            string             `json:"feedback,omitempty"`
	Payload             map[string]any     `json:"payload,omitempty"`
}

type StateDelta struct {
	Interaction    Interaction         `json:"interaction"`
	Evaluation     Evaluation          `json:"evaluation"`
	Before         LearnerState        `json:"before"`
	After          LearnerState        `json:"after"`
	Snapshot       PedagogicalSnapshot `json:"snapshot"`
	Misconceptions []Misconception     `json:"misconceptions,omitempty"`
	Events         []Event             `json:"events"`
}
