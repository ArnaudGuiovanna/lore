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
)

// Valid reports whether r is one of the recognized membership roles.
func (r Role) Valid() bool {
	switch r {
	case RoleSuperAdmin, RoleTenantAdmin, RoleTrainer, RoleLearner:
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
}

type User struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

type Membership struct {
	TenantID  string    `json:"tenant_id"`
	UserID    string    `json:"user_id"`
	Role      Role      `json:"role"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

type Program struct {
	TenantID  string    `json:"tenant_id"`
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

type Cohort struct {
	TenantID  string    `json:"tenant_id"`
	ID        string    `json:"id"`
	ProgramID string    `json:"program_id"`
	Name      string    `json:"name"`
	StartDate time.Time `json:"start_date"`
	EndDate   time.Time `json:"end_date"`
	CreatedAt time.Time `json:"created_at"`
}

type CohortEnrollment struct {
	TenantID  string    `json:"tenant_id"`
	CohortID  string    `json:"cohort_id"`
	LearnerID string    `json:"learner_id"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
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
}

type LLMConfiguration struct {
	TenantID         string    `json:"tenant_id"`
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

type StateDelta struct {
	Interaction Interaction         `json:"interaction"`
	Evaluation  Evaluation          `json:"evaluation"`
	Before      LearnerState        `json:"before"`
	After       LearnerState        `json:"after"`
	Snapshot    PedagogicalSnapshot `json:"snapshot"`
	Events      []Event             `json:"events"`
}
