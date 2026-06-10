package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"lore/internal/auth"
	"lore/internal/cache"
	"lore/internal/core"
	"lore/internal/llm"
	"lore/internal/observability"
	"lore/internal/runtime"
)

type Repository interface {
	runtime.Store
	CreateTenant(ctx context.Context, name, slug, parentID string) (core.Tenant, error)
	GetTenant(ctx context.Context, tenantID string) (core.Tenant, error)
	UpdateTenantProfile(ctx context.Context, tenantID string, profile map[string]any, actorUserID ...string) (core.Tenant, error)
	ListTenants(ctx context.Context) ([]core.Tenant, error)
	CreateUser(ctx context.Context, email, name string) (core.User, error)
	AddMembership(ctx context.Context, tenantID, userID string, role core.Role, actorUserID ...string) (core.Membership, error)
	ListMemberships(ctx context.Context, tenantID string) ([]core.Membership, error)
	ListTenantUsers(ctx context.Context, tenantID string) ([]core.TenantUser, error)
	UpdateTenantUser(ctx context.Context, tenantID, userID, email, name, status string, actorUserID ...string) (core.TenantUser, error)
	ArchiveTenantUser(ctx context.Context, tenantID, userID string, actorUserID ...string) (core.TenantUser, error)
	ListLearners(ctx context.Context, tenantID string) ([]core.Learner, error)
	CreateProgram(ctx context.Context, tenantID, name string, actorUserID ...string) (core.Program, error)
	ListPrograms(ctx context.Context, tenantID string) ([]core.Program, error)
	UpdateProgram(ctx context.Context, tenantID, programID, name, status string, actorUserID ...string) (core.Program, error)
	ArchiveProgram(ctx context.Context, tenantID, programID string, actorUserID ...string) (core.Program, error)
	CreateCohort(ctx context.Context, tenantID, programID, name string, start, end time.Time, actorUserID ...string) (core.Cohort, error)
	ListCohorts(ctx context.Context, tenantID string) ([]core.Cohort, error)
	UpdateCohort(ctx context.Context, tenantID, cohortID, programID, name, status string, start, end time.Time, actorUserID ...string) (core.Cohort, error)
	ArchiveCohort(ctx context.Context, tenantID, cohortID string, actorUserID ...string) (core.Cohort, error)
	EnrollLearner(ctx context.Context, tenantID, cohortID, learnerID string, actorUserID ...string) (core.CohortEnrollment, error)
	ListCohortEnrollments(ctx context.Context, tenantID, cohortID string) ([]core.CohortEnrollment, error)
	UpdateCohortEnrollmentStatus(ctx context.Context, tenantID, cohortID, learnerID, status string, actorUserID ...string) (core.CohortEnrollment, error)
	ArchiveCohortEnrollment(ctx context.Context, tenantID, cohortID, learnerID string, actorUserID ...string) (core.CohortEnrollment, error)
	CreateTrainingSession(ctx context.Context, session core.TrainingSession, actorUserID ...string) (core.TrainingSession, error)
	ListTrainingSessions(ctx context.Context, tenantID, cohortID string) ([]core.TrainingSession, error)
	UpdateTrainingSession(ctx context.Context, tenantID, sessionID string, patch core.TrainingSessionPatch, actorUserID ...string) (core.TrainingSession, error)
	ArchiveTrainingSession(ctx context.Context, tenantID, sessionID string, actorUserID ...string) (core.TrainingSession, error)
	ListAdminAuditLogs(ctx context.Context, tenantID, targetType, targetID string) ([]core.AdminAuditLog, error)
	CreateSyllabus(ctx context.Context, tenantID, title, description string, objectives, outcomes map[string]any) (core.Syllabus, error)
	ListSyllabi(ctx context.Context, tenantID string) ([]core.Syllabus, error)
	BindSyllabus(ctx context.Context, tenantID, syllabusID, targetType, targetID, adaptationMode string) (core.SyllabusBinding, error)
	EraseLearnerData(ctx context.Context, tenantID, learnerID string, actorUserID ...string) (map[string]int, error)
	ListPositioningEvidence(ctx context.Context, tenantID, learnerID, domainID string) ([]core.Interaction, error)
	ListGeneratedContentForReview(ctx context.Context, tenantID, status string) ([]core.GeneratedContent, error)
	ReviewGeneratedContent(ctx context.Context, tenantID, contentID, status, note, reviewerID string) (core.GeneratedContent, error)
	CreateAnnouncement(ctx context.Context, announcement core.Announcement, actorUserID ...string) (core.Announcement, error)
	ListAnnouncements(ctx context.Context, tenantID, learnerID string) ([]core.Announcement, error)
	ArchiveAnnouncement(ctx context.Context, tenantID, announcementID string, actorUserID ...string) (core.Announcement, error)
	CreateFundingFile(ctx context.Context, file core.FundingFile, actorUserID ...string) (core.FundingFile, error)
	ListFundingFiles(ctx context.Context, tenantID, learnerID string) ([]core.FundingFile, error)
	UpdateFundingFile(ctx context.Context, tenantID, fileID string, patch core.FundingFilePatch, actorUserID ...string) (core.FundingFile, error)
	ArchiveFundingFile(ctx context.Context, tenantID, fileID string, actorUserID ...string) (core.FundingFile, error)
	BPFExport(ctx context.Context, tenantID string, year int) (core.BPFReport, error)
	PublishLegalText(ctx context.Context, text core.LegalText, actorUserID ...string) (core.LegalText, error)
	ListLegalTexts(ctx context.Context, tenantID string, history bool) ([]core.LegalText, error)
	RecordConsent(ctx context.Context, tenantID, userID, legalTextID string) (core.Consent, error)
	ListConsents(ctx context.Context, tenantID, userID string) ([]core.Consent, error)
	CreateDocument(ctx context.Context, doc core.OFDocument, actorUserID ...string) (core.OFDocument, error)
	NewDocumentVersion(ctx context.Context, tenantID, documentID, title, body string, actorUserID ...string) (core.OFDocument, error)
	ListDocuments(ctx context.Context, tenantID, learnerID string) ([]core.OFDocument, error)
	GetDocument(ctx context.Context, tenantID, documentID string) (core.OFDocument, error)
	ArchiveDocument(ctx context.Context, tenantID, documentID string, actorUserID ...string) (core.OFDocument, error)
	CreateBankQuestion(ctx context.Context, q core.BankQuestion, actorUserID ...string) (core.BankQuestion, error)
	ListBankQuestions(ctx context.Context, tenantID, conceptID string) ([]core.BankQuestion, error)
	ArchiveBankQuestion(ctx context.Context, tenantID, questionID string, actorUserID ...string) (core.BankQuestion, error)
	CreateAssignment(ctx context.Context, assignment core.Assignment, actorUserID ...string) (core.Assignment, error)
	ListAssignments(ctx context.Context, tenantID, cohortID string) ([]core.Assignment, error)
	GetAssignment(ctx context.Context, tenantID, assignmentID string) (core.Assignment, error)
	SubmitAssignment(ctx context.Context, submission core.AssignmentSubmission) (core.AssignmentSubmission, error)
	ListAssignmentSubmissions(ctx context.Context, tenantID, assignmentID string) ([]core.AssignmentSubmission, error)
	GradeAssignmentSubmission(ctx context.Context, tenantID, submissionID string, score float64, feedback, graderID string) (core.AssignmentSubmission, error)
	CreateSurvey(ctx context.Context, survey core.SatisfactionSurvey, actorUserID ...string) (core.SatisfactionSurvey, error)
	ListSurveys(ctx context.Context, tenantID, cohortID string) ([]core.SatisfactionSurvey, error)
	GetSurvey(ctx context.Context, tenantID, surveyID string) (core.SatisfactionSurvey, error)
	SubmitSurveyResponse(ctx context.Context, response core.SurveyResponse) (core.SurveyResponse, error)
	ListSurveyResponses(ctx context.Context, tenantID, surveyID string) ([]core.SurveyResponse, error)
	CreateComplaint(ctx context.Context, complaint core.Complaint) (core.Complaint, error)
	ListComplaints(ctx context.Context, tenantID string) ([]core.Complaint, error)
	UpdateComplaint(ctx context.Context, tenantID, complaintID, status, resolution string, actorUserID ...string) (core.Complaint, error)
	CreateCohortInvite(ctx context.Context, tenantID, cohortID string, expiresAt *time.Time, maxUses int, actorUserID ...string) (core.CohortInvite, error)
	ListCohortInvites(ctx context.Context, tenantID, cohortID string) ([]core.CohortInvite, error)
	RevokeCohortInvite(ctx context.Context, tenantID, inviteID string, actorUserID ...string) (core.CohortInvite, error)
	GetCohortInviteByCode(ctx context.Context, code string) (core.CohortInvite, error)
	ConsumeCohortInvite(ctx context.Context, code string) (core.CohortInvite, error)
	CreateCourseModule(ctx context.Context, module core.CourseModule, actorUserID ...string) (core.CourseModule, error)
	ListCourseModules(ctx context.Context, tenantID, syllabusID string) ([]core.CourseModule, error)
	UpdateCourseModule(ctx context.Context, tenantID, moduleID string, patch core.CourseModulePatch, actorUserID ...string) (core.CourseModule, error)
	ArchiveCourseModule(ctx context.Context, tenantID, moduleID string, actorUserID ...string) (core.CourseModule, error)
	LearnerModulePath(ctx context.Context, tenantID, learnerID, syllabusID string) ([]core.ModuleProgress, error)
	CreateDomain(ctx context.Context, tenantID, ownerID, name, description, source string, drafts []core.ConceptDraft, depDrafts []core.DependencyDraft) (core.DomainGraph, error)
	ListDomains(ctx context.Context, tenantID string) ([]core.Domain, error)
	ReplaceDomainGraph(ctx context.Context, tenantID, domainID string, drafts []core.ConceptDraft, depDrafts []core.DependencyDraft) (core.DomainGraph, error)
	StartActivity(ctx context.Context, tenantID, activityID string) (core.Activity, error)
	PauseActivity(ctx context.Context, tenantID, activityID string) (core.Activity, error)
	ResumeActivity(ctx context.Context, tenantID, activityID string) (core.Activity, error)
	ListDueReviews(ctx context.Context, tenantID, learnerID string, now time.Time) ([]core.ReviewCard, error)
	GetInstruction(ctx context.Context, tenantID, instructionID string) (core.TutorInstruction, error)
	SaveGeneratedContent(ctx context.Context, content core.GeneratedContent) error
	ListGeneratedContent(ctx context.Context, tenantID, instructionID string) ([]core.GeneratedContent, error)
	GetGeneratedContent(ctx context.Context, tenantID, contentID string) (core.GeneratedContent, error)
	GetLLMConfiguration(ctx context.Context, tenantID, scopeType, scopeID string) (core.LLMConfiguration, error)
	SaveLLMConfiguration(ctx context.Context, config core.LLMConfiguration) (core.LLMConfiguration, error)
	ListSnapshots(ctx context.Context, tenantID, learnerID string) ([]core.PedagogicalSnapshot, error)
	GetIdempotencyRecord(ctx context.Context, tenantID, idempotencyKey string) (core.IdempotencyRecord, error)
	SaveIdempotencyRecord(ctx context.Context, record core.IdempotencyRecord) error
	SaveInteractionDeltaIdempotent(ctx context.Context, delta core.StateDelta, activity core.Activity, record core.IdempotencyRecord) error
	ListEvents(ctx context.Context, tenantID string, unpublishedOnly bool) ([]core.Event, error)
	MarkEventPublished(ctx context.Context, tenantID, eventID string, now time.Time) (core.Event, error)
	ListAlerts(ctx context.Context, tenantID string, now time.Time) ([]core.Alert, error)
	UpdateAlertStatus(ctx context.Context, tenantID, alertID, status string, now time.Time) (core.Alert, error)
	CohortAnalytics(ctx context.Context, tenantID, cohortID string) (map[string]any, error)
	CohortProgress(ctx context.Context, tenantID, cohortID string, masteryThreshold float64) ([]core.LearnerProgressSummary, error)
}

const (
	idempotencyKeyHeader   = "Idempotency-Key"
	idempotentReplayHeader = "X-LORE-Idempotent-Replay"
)

type claimsContextKey struct{}

type Server struct {
	store     Repository
	engine    *runtime.Engine
	generator llm.Generator

	configMu       sync.RWMutex
	llmProvider    string
	llmModel       string
	tokens         *auth.TokenService
	bootstrapToken string
	cache          cache.Cache
	metrics        *observability.Metrics
	metricsToken   string
	authMu         sync.Mutex
	authAttempts   map[string]authAttempt
}

// maxTokenTTL caps the lifetime of any issued JWT regardless of the requested
// ttl_seconds, limiting the blast radius of a leaked token.
const maxTokenTTL = 24 * time.Hour

const (
	maxAuthFailures   = 5
	authFailureWindow = 15 * time.Minute
	authLockout       = 15 * time.Minute
)

type authAttempt struct {
	Failures     int
	FirstFailure time.Time
	LockedUntil  time.Time
}

func NewServer(store Repository, engine *runtime.Engine, generator llm.Generator, provider, model string) *Server {
	return &Server{
		store:        store,
		engine:       engine,
		generator:    generator,
		llmProvider:  provider,
		llmModel:     model,
		metrics:      observability.NewMetrics(),
		authAttempts: map[string]authAttempt{},
	}
}

func (s *Server) EnableJWT(secret string) {
	if secret != "" {
		s.tokens = auth.NewTokenService(secret)
	}
}

// EnableJWTService installs a pre-built token service, allowing asymmetric
// (RS256) configuration, including verify-only services for externally issued
// (OIDC) tokens.
func (s *Server) EnableJWTService(svc *auth.TokenService) {
	if svc != nil {
		s.tokens = svc
	}
}

// EnableBootstrap installs an operator-side secret that authorizes the trust
// anchor operations (issuing tokens and managing memberships) so the first
// administrator can be provisioned before any JWT exists.
func (s *Server) EnableBootstrap(token string) {
	s.bootstrapToken = token
}

// EnableMetricsToken protects GET /metrics with a static bearer token suitable
// for Prometheus scrape credentials.
func (s *Server) EnableMetricsToken(token string) {
	s.metricsToken = strings.TrimSpace(token)
}

func (s *Server) EnableCache(c cache.Cache) {
	if c != nil {
		s.cache = c
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.Handle("GET /metrics", s.metricsEndpoint(s.metrics.Handler()))

	mux.HandleFunc("POST /v1/auth/token", s.issueToken)
	mux.HandleFunc("GET /v1/tenants", s.listTenants)
	mux.HandleFunc("POST /v1/tenants", s.createTenant)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}", s.getTenant)
	mux.HandleFunc("POST /v1/users", s.createUser)

	mux.HandleFunc("POST /v1/tenants/{tenant_id}/memberships", s.addMembership)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/memberships", s.listMemberships)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/users", s.listTenantUsers)
	mux.HandleFunc("PATCH /v1/tenants/{tenant_id}/users/{user_id}", s.patchTenantUser)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/users/{user_id}", s.archiveTenantUser)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/learners", s.listLearners)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/programs", s.listPrograms)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/programs", s.createProgram)
	mux.HandleFunc("PATCH /v1/tenants/{tenant_id}/programs/{program_id}", s.patchProgram)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/programs/{program_id}", s.archiveProgram)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/cohorts", s.listCohorts)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/cohorts", s.createCohort)
	mux.HandleFunc("PATCH /v1/tenants/{tenant_id}/cohorts/{cohort_id}", s.patchCohort)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/cohorts/{cohort_id}", s.archiveCohort)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/cohorts/{cohort_id}/enrollments", s.listCohortEnrollments)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/cohorts/{cohort_id}/enrollments", s.enrollLearner)
	mux.HandleFunc("PATCH /v1/tenants/{tenant_id}/cohorts/{cohort_id}/enrollments/{learner_id}", s.patchCohortEnrollment)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/cohorts/{cohort_id}/enrollments/{learner_id}", s.archiveCohortEnrollment)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/training-sessions", s.listTrainingSessions)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/training-sessions", s.createTrainingSession)
	mux.HandleFunc("PATCH /v1/tenants/{tenant_id}/training-sessions/{session_id}", s.patchTrainingSession)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/training-sessions/{session_id}", s.archiveTrainingSession)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/training-sessions.ics", s.trainingSessionsICS)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/admin-audit-logs", s.listAdminAuditLogs)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/syllabi", s.listSyllabi)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/syllabi", s.createSyllabus)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/syllabi/{syllabus_id}/bindings", s.bindSyllabus)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/learners/{learner_id}/data", s.eraseLearnerData)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/learners/{learner_id}/positioning", s.learnerPositioning)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/content-review", s.listContentForReview)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/content-review/{content_id}", s.reviewContent)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/announcements", s.createAnnouncement)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/announcements", s.listAnnouncements)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/announcements/{announcement_id}", s.archiveAnnouncement)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/funding-files", s.createFundingFile)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/funding-files", s.listFundingFiles)
	mux.HandleFunc("PATCH /v1/tenants/{tenant_id}/funding-files/{file_id}", s.updateFundingFile)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/funding-files/{file_id}", s.archiveFundingFile)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/bpf-export", s.bpfExport)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/legal-texts", s.publishLegalText)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/legal-texts", s.listLegalTexts)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/consents", s.recordConsent)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/consents", s.listConsents)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/documents", s.createDocument)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/documents", s.listDocuments)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/documents/{document_id}", s.getDocument)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/documents/{document_id}/versions", s.newDocumentVersion)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/documents/{document_id}", s.archiveDocument)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/questions", s.createBankQuestion)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/questions", s.listBankQuestions)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/questions/{question_id}", s.archiveBankQuestion)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/cohorts/{cohort_id}/assignments", s.createAssignment)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/assignments", s.listAssignments)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/assignments/{assignment_id}/submissions", s.submitAssignment)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/assignments/{assignment_id}/submissions", s.listAssignmentSubmissions)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/submissions/{submission_id}/grade", s.gradeSubmission)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/profile", s.getTenantProfile)
	mux.HandleFunc("PUT /v1/tenants/{tenant_id}/profile", s.updateTenantProfile)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/cohorts/{cohort_id}/qualiopi-export", s.qualiopiExport)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/cohorts/{cohort_id}/surveys", s.createSurvey)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/surveys", s.listSurveys)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/surveys/{survey_id}", s.getSurvey)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/surveys/{survey_id}/responses", s.submitSurveyResponse)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/surveys/{survey_id}/responses", s.listSurveyResponses)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/complaints", s.createComplaint)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/complaints", s.listComplaints)
	mux.HandleFunc("PATCH /v1/tenants/{tenant_id}/complaints/{complaint_id}", s.updateComplaint)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/cohorts/{cohort_id}/invites", s.createCohortInvite)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/cohorts/{cohort_id}/invites", s.listCohortInvites)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/invites/{invite_id}", s.revokeCohortInvite)
	mux.HandleFunc("GET /v1/invites/{code}", s.lookupInvite)
	mux.HandleFunc("POST /v1/invites/{code}/redeem", s.redeemInvite)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/syllabi/{syllabus_id}/modules", s.listCourseModules)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/syllabi/{syllabus_id}/modules", s.createCourseModule)
	mux.HandleFunc("PATCH /v1/tenants/{tenant_id}/modules/{module_id}", s.updateCourseModule)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/modules/{module_id}", s.archiveCourseModule)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/learners/{learner_id}/path", s.learnerModulePath)

	mux.HandleFunc("GET /v1/tenants/{tenant_id}/domains", s.listDomains)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/domains", s.createDomain)
	mux.HandleFunc("PUT /v1/tenants/{tenant_id}/domains/{domain_id}/graph", s.replaceDomainGraph)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/domains/{domain_id}", s.getDomain)

	mux.HandleFunc("POST /v1/tenants/{tenant_id}/learners/{learner_id}/activities/next", s.nextActivity)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/activities/{activity_id}/start", s.startActivity)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/activities/{activity_id}/pause", s.pauseActivity)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/activities/{activity_id}/resume", s.resumeActivity)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/interactions", s.recordInteraction)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/learners/{learner_id}/assessments/plan", s.planAssessment)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/assessments/{activity_id}/submit", s.submitAssessment)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/learners/{learner_id}/state", s.learnerState)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/learners/{learner_id}/reviews/due", s.dueReviews)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/learners/{learner_id}/snapshots", s.snapshots)

	mux.HandleFunc("GET /v1/tenants/{tenant_id}/llm-configurations", s.getLLMConfig)
	mux.HandleFunc("PUT /v1/tenants/{tenant_id}/llm-configurations", s.putLLMConfig)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/tutor-instructions/{instruction_id}/generate", s.generateContent)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/generated-content", s.listGeneratedContent)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/generated-content/{content_id}", s.getGeneratedContent)

	mux.HandleFunc("GET /v1/tenants/{tenant_id}/events/outbox", s.outboxEvents)
	mux.HandleFunc("PATCH /v1/tenants/{tenant_id}/events/{event_id}/published", s.markEventPublished)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/analytics/cohorts/{cohort_id}", s.cohortAnalytics)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/analytics/cohorts/{cohort_id}/training-time.csv", s.cohortTrainingTimeCSV)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/analytics/cohorts/{cohort_id}/progress.csv", s.cohortProgressCSV)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/alerts", s.alerts)
	mux.HandleFunc("PATCH /v1/tenants/{tenant_id}/alerts/{alert_id}", s.patchAlert)
	var handler http.Handler = mux
	if s.tokens != nil {
		handler = s.authMiddleware(mux)
	}
	// Metrics wrap the auth layer so rejected requests are measured too; the mux
	// is passed separately to resolve the low-cardinality route label. OTel server
	// spans wrap the outside (no-op unless a collector endpoint is configured).
	handler = s.metrics.Instrument(mux, handler)
	return observability.WrapHTTP(handler, "lore-http")
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) metricsEndpoint(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.authorizeMetrics(w, r) {
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) authorizeMetrics(w http.ResponseWriter, r *http.Request) bool {
	expected := strings.TrimSpace(s.metricsToken)
	if expected == "" {
		return true
	}
	provided := bearerToken(r.Header.Get("Authorization"))
	if provided == "" {
		provided = strings.TrimSpace(r.Header.Get("X-LORE-Metrics-Token"))
	}
	if subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1 {
		return true
	}
	w.Header().Set("WWW-Authenticate", `Bearer realm="lore-metrics"`)
	problem(w, http.StatusUnauthorized, "metrics token is required")
	return false
}

func bearerToken(value string) string {
	scheme, token, ok := strings.Cut(strings.TrimSpace(value), " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return ""
	}
	return strings.TrimSpace(token)
}

func (s *Server) listTenants(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeTenantList(w, r) {
		return
	}
	tenants, err := s.store.ListTenants(r.Context())
	respond(w, tenants, err, http.StatusOK)
}

func (s *Server) createTenant(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name     string `json:"name"`
		Slug     string `json:"slug"`
		ParentID string `json:"parent_id"`
	}
	if !decode(w, r, &req) {
		return
	}
	tenant, err := s.store.CreateTenant(r.Context(), req.Name, req.Slug, req.ParentID)
	respond(w, tenant, err, http.StatusCreated)
}

func (s *Server) getTenant(w http.ResponseWriter, r *http.Request) {
	tenant, err := s.store.GetTenant(r.Context(), r.PathValue("tenant_id"))
	respond(w, tenant, err, http.StatusOK)
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	if !decode(w, r, &req) {
		return
	}
	user, err := s.store.CreateUser(r.Context(), req.Email, req.Name)
	respond(w, user, err, http.StatusCreated)
}

func (s *Server) issueToken(w http.ResponseWriter, r *http.Request) {
	if s.tokens == nil {
		problem(w, http.StatusNotFound, "jwt authentication is not enabled")
		return
	}
	if !s.tokens.CanIssue() {
		problem(w, http.StatusNotImplemented, "token issuance is delegated to the identity provider; present an externally-issued bearer token")
		return
	}
	var req struct {
		TenantID   string `json:"tenant_id"`
		UserID     string `json:"user_id"`
		TTLSeconds int64  `json:"ttl_seconds"`
	}
	if !decode(w, r, &req) {
		return
	}
	authKey := authAttemptKey(r, req.TenantID, req.UserID)
	if retryAfter, locked := s.authAttemptLocked(authKey, time.Now().UTC()); locked {
		w.Header().Set("Retry-After", strconv.FormatInt(int64(retryAfter.Seconds()), 10))
		problem(w, http.StatusTooManyRequests, "too many failed token requests; retry later")
		return
	}
	authFailed := true
	defer func() {
		if authFailed {
			s.recordAuthFailure(authKey, time.Now().UTC())
			return
		}
		s.recordAuthSuccess(authKey)
	}()
	if !s.authorizeTokenIssue(w, r, req.TenantID, req.UserID) {
		return
	}
	memberships, err := s.store.ListMemberships(r.Context(), req.TenantID)
	if err != nil {
		respond(w, nil, err, http.StatusOK)
		return
	}
	var role core.Role
	for _, membership := range memberships {
		if membership.UserID == req.UserID && membership.Status == "ACTIVE" {
			role = membership.Role
			break
		}
	}
	if role == "" {
		problem(w, http.StatusForbidden, "active membership is required")
		return
	}
	ttl := time.Duration(req.TTLSeconds) * time.Second
	if ttl > maxTokenTTL {
		ttl = maxTokenTTL
	}
	token, err := s.tokens.Issue(req.UserID, req.TenantID, string(role), ttl)
	if err != nil {
		respond(w, nil, err, http.StatusOK)
		return
	}
	authFailed = false
	writeJSON(w, http.StatusOK, map[string]any{"access_token": token, "token_type": "Bearer"})
}

func (s *Server) addMembership(w http.ResponseWriter, r *http.Request) {
	var req struct {
		UserID string    `json:"user_id"`
		Role   core.Role `json:"role"`
	}
	if !decode(w, r, &req) {
		return
	}
	role := req.Role
	if role == "" {
		role = core.RoleLearner
	}
	if !role.Valid() {
		problem(w, http.StatusBadRequest, "role must be one of SUPER_ADMIN, TENANT_ADMIN, TRAINER, GESTIONNAIRE, LEARNER")
		return
	}
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeMembershipWrite(w, r, tenantID, role) {
		return
	}
	membership, err := s.store.AddMembership(r.Context(), tenantID, req.UserID, role, actorUserIDFromRequest(r))
	respond(w, membership, err, http.StatusCreated)
}

func (s *Server) listMemberships(w http.ResponseWriter, r *http.Request) {
	memberships, err := s.store.ListMemberships(r.Context(), r.PathValue("tenant_id"))
	respond(w, memberships, err, http.StatusOK)
}

func (s *Server) listTenantUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.ListTenantUsers(r.Context(), r.PathValue("tenant_id"))
	respond(w, users, err, http.StatusOK)
}

func (s *Server) patchTenantUser(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageUsers) {
		return
	}
	var req struct {
		Email  string `json:"email"`
		Name   string `json:"name"`
		Status string `json:"status"`
	}
	if !decode(w, r, &req) {
		return
	}
	user, err := s.store.UpdateTenantUser(r.Context(), tenantID, r.PathValue("user_id"), req.Email, req.Name, req.Status, actorUserIDFromRequest(r))
	respond(w, user, err, http.StatusOK)
}

func (s *Server) archiveTenantUser(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageUsers) {
		return
	}
	user, err := s.store.ArchiveTenantUser(r.Context(), tenantID, r.PathValue("user_id"), actorUserIDFromRequest(r))
	respond(w, user, err, http.StatusOK)
}

func (s *Server) listLearners(w http.ResponseWriter, r *http.Request) {
	learners, err := s.store.ListLearners(r.Context(), r.PathValue("tenant_id"))
	respond(w, learners, err, http.StatusOK)
}

func (s *Server) listPrograms(w http.ResponseWriter, r *http.Request) {
	programs, err := s.store.ListPrograms(r.Context(), r.PathValue("tenant_id"))
	respond(w, programs, err, http.StatusOK)
}

func (s *Server) createProgram(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageEnrollments) {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &req) {
		return
	}
	program, err := s.store.CreateProgram(r.Context(), tenantID, req.Name, actorUserIDFromRequest(r))
	respond(w, program, err, http.StatusCreated)
}

func (s *Server) patchProgram(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageEnrollments) {
		return
	}
	var req struct {
		Name   string `json:"name"`
		Status string `json:"status"`
	}
	if !decode(w, r, &req) {
		return
	}
	program, err := s.store.UpdateProgram(r.Context(), tenantID, r.PathValue("program_id"), req.Name, req.Status, actorUserIDFromRequest(r))
	respond(w, program, err, http.StatusOK)
}

func (s *Server) archiveProgram(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageEnrollments) {
		return
	}
	program, err := s.store.ArchiveProgram(r.Context(), tenantID, r.PathValue("program_id"), actorUserIDFromRequest(r))
	respond(w, program, err, http.StatusOK)
}

func (s *Server) listCohorts(w http.ResponseWriter, r *http.Request) {
	cohorts, err := s.store.ListCohorts(r.Context(), r.PathValue("tenant_id"))
	respond(w, cohorts, err, http.StatusOK)
}

func (s *Server) createCohort(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageEnrollments) {
		return
	}
	var req struct {
		ProgramID string `json:"program_id"`
		Name      string `json:"name"`
		StartDate string `json:"start_date"`
		EndDate   string `json:"end_date"`
	}
	if !decode(w, r, &req) {
		return
	}
	start, err := parseDate(req.StartDate)
	if err != nil {
		problem(w, http.StatusBadRequest, err.Error())
		return
	}
	end, err := parseDate(req.EndDate)
	if err != nil {
		problem(w, http.StatusBadRequest, err.Error())
		return
	}
	cohort, err := s.store.CreateCohort(r.Context(), tenantID, req.ProgramID, req.Name, start, end, actorUserIDFromRequest(r))
	respond(w, cohort, err, http.StatusCreated)
}

func (s *Server) patchCohort(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageEnrollments) {
		return
	}
	var req struct {
		ProgramID string `json:"program_id"`
		Name      string `json:"name"`
		StartDate string `json:"start_date"`
		EndDate   string `json:"end_date"`
		Status    string `json:"status"`
	}
	if !decode(w, r, &req) {
		return
	}
	start, err := parseDate(req.StartDate)
	if err != nil {
		problem(w, http.StatusBadRequest, err.Error())
		return
	}
	end, err := parseDate(req.EndDate)
	if err != nil {
		problem(w, http.StatusBadRequest, err.Error())
		return
	}
	cohort, err := s.store.UpdateCohort(r.Context(), tenantID, r.PathValue("cohort_id"), req.ProgramID, req.Name, req.Status, start, end, actorUserIDFromRequest(r))
	respond(w, cohort, err, http.StatusOK)
}

func (s *Server) archiveCohort(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageEnrollments) {
		return
	}
	cohort, err := s.store.ArchiveCohort(r.Context(), tenantID, r.PathValue("cohort_id"), actorUserIDFromRequest(r))
	respond(w, cohort, err, http.StatusOK)
}

func (s *Server) listCohortEnrollments(w http.ResponseWriter, r *http.Request) {
	enrollments, err := s.store.ListCohortEnrollments(r.Context(), r.PathValue("tenant_id"), r.PathValue("cohort_id"))
	respond(w, enrollments, err, http.StatusOK)
}

func (s *Server) enrollLearner(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageEnrollments) {
		return
	}
	var req struct {
		LearnerID string `json:"learner_id"`
	}
	if !decode(w, r, &req) {
		return
	}
	enrollment, err := s.store.EnrollLearner(r.Context(), tenantID, r.PathValue("cohort_id"), req.LearnerID, actorUserIDFromRequest(r))
	respond(w, enrollment, err, http.StatusCreated)
}

func (s *Server) patchCohortEnrollment(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageEnrollments) {
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	if !decode(w, r, &req) {
		return
	}
	enrollment, err := s.store.UpdateCohortEnrollmentStatus(r.Context(), tenantID, r.PathValue("cohort_id"), r.PathValue("learner_id"), req.Status, actorUserIDFromRequest(r))
	respond(w, enrollment, err, http.StatusOK)
}

func (s *Server) archiveCohortEnrollment(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageEnrollments) {
		return
	}
	enrollment, err := s.store.ArchiveCohortEnrollment(r.Context(), tenantID, r.PathValue("cohort_id"), r.PathValue("learner_id"), actorUserIDFromRequest(r))
	respond(w, enrollment, err, http.StatusOK)
}

func (s *Server) listTrainingSessions(w http.ResponseWriter, r *http.Request) {
	sessions, err := s.store.ListTrainingSessions(r.Context(), r.PathValue("tenant_id"), r.URL.Query().Get("cohort_id"))
	respond(w, sessions, err, http.StatusOK)
}

func (s *Server) createTrainingSession(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageSessions) {
		return
	}
	var req struct {
		CohortID string `json:"cohort_id"`
		Title    string `json:"title"`
		StartsAt string `json:"starts_at"`
		EndsAt   string `json:"ends_at"`
		Capacity int    `json:"capacity"`
		Location string `json:"location"`
		VideoURL string `json:"video_url"`
	}
	if !decode(w, r, &req) {
		return
	}
	startsAt, err := parseDateTime(req.StartsAt)
	if err != nil {
		problem(w, http.StatusBadRequest, err.Error())
		return
	}
	endsAt, err := parseDateTime(req.EndsAt)
	if err != nil {
		problem(w, http.StatusBadRequest, err.Error())
		return
	}
	session, err := s.store.CreateTrainingSession(r.Context(), core.TrainingSession{
		TenantID: tenantID,
		CohortID: req.CohortID,
		Title:    req.Title,
		StartsAt: startsAt,
		EndsAt:   endsAt,
		Capacity: req.Capacity,
		Location: req.Location,
		VideoURL: req.VideoURL,
	}, actorUserIDFromRequest(r))
	respond(w, session, err, http.StatusCreated)
}

func (s *Server) patchTrainingSession(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageSessions) {
		return
	}
	var req struct {
		CohortID *string `json:"cohort_id"`
		Title    *string `json:"title"`
		StartsAt *string `json:"starts_at"`
		EndsAt   *string `json:"ends_at"`
		Capacity *int    `json:"capacity"`
		Location *string `json:"location"`
		VideoURL *string `json:"video_url"`
		Status   *string `json:"status"`
	}
	if !decode(w, r, &req) {
		return
	}
	patch := core.TrainingSessionPatch{
		CohortID: req.CohortID,
		Title:    req.Title,
		Capacity: req.Capacity,
		Location: req.Location,
		VideoURL: req.VideoURL,
		Status:   req.Status,
	}
	if req.StartsAt != nil {
		startsAt, err := parseDateTime(*req.StartsAt)
		if err != nil {
			problem(w, http.StatusBadRequest, err.Error())
			return
		}
		patch.StartsAt = &startsAt
	}
	if req.EndsAt != nil {
		endsAt, err := parseDateTime(*req.EndsAt)
		if err != nil {
			problem(w, http.StatusBadRequest, err.Error())
			return
		}
		patch.EndsAt = &endsAt
	}
	session, err := s.store.UpdateTrainingSession(r.Context(), tenantID, r.PathValue("session_id"), patch, actorUserIDFromRequest(r))
	respond(w, session, err, http.StatusOK)
}

func (s *Server) archiveTrainingSession(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageSessions) {
		return
	}
	session, err := s.store.ArchiveTrainingSession(r.Context(), tenantID, r.PathValue("session_id"), actorUserIDFromRequest(r))
	respond(w, session, err, http.StatusOK)
}

func (s *Server) listAdminAuditLogs(w http.ResponseWriter, r *http.Request) {
	logs, err := s.store.ListAdminAuditLogs(r.Context(), r.PathValue("tenant_id"), r.URL.Query().Get("target_type"), r.URL.Query().Get("target_id"))
	respond(w, logs, err, http.StatusOK)
}

func (s *Server) listSyllabi(w http.ResponseWriter, r *http.Request) {
	syllabi, err := s.store.ListSyllabi(r.Context(), r.PathValue("tenant_id"))
	respond(w, syllabi, err, http.StatusOK)
}

func (s *Server) createSyllabus(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title       string         `json:"title"`
		Description string         `json:"description"`
		Objectives  map[string]any `json:"objectives"`
		Outcomes    map[string]any `json:"outcomes"`
	}
	if !decode(w, r, &req) {
		return
	}
	syllabus, err := s.store.CreateSyllabus(r.Context(), r.PathValue("tenant_id"), req.Title, req.Description, req.Objectives, req.Outcomes)
	respond(w, syllabus, err, http.StatusCreated)
}

// trainingSessionsICS exports the planned sessions as an iCalendar feed
// (B-25) so cohort planning lands in any calendar client. Archived sessions
// are skipped; visio links ride in URL/DESCRIPTION.
func (s *Server) trainingSessionsICS(w http.ResponseWriter, r *http.Request) {
	sessions, err := s.store.ListTrainingSessions(r.Context(), r.PathValue("tenant_id"), r.URL.Query().Get("cohort_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	icsEscape := func(value string) string {
		value = strings.ReplaceAll(value, `\`, `\\`)
		value = strings.ReplaceAll(value, ";", `\;`)
		value = strings.ReplaceAll(value, ",", `\,`)
		value = strings.ReplaceAll(value, "\n", `\n`)
		return value
	}
	const stamp = "20060102T150405Z"
	var b strings.Builder
	b.WriteString("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//LORE//training-sessions//FR\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n")
	for _, session := range sessions {
		if session.ArchivedAt != nil {
			continue
		}
		b.WriteString("BEGIN:VEVENT\r\n")
		b.WriteString("UID:" + icsEscape(session.ID) + "@lore\r\n")
		b.WriteString("DTSTAMP:" + session.CreatedAt.UTC().Format(stamp) + "\r\n")
		b.WriteString("DTSTART:" + session.StartsAt.UTC().Format(stamp) + "\r\n")
		b.WriteString("DTEND:" + session.EndsAt.UTC().Format(stamp) + "\r\n")
		b.WriteString("SUMMARY:" + icsEscape(session.Title) + "\r\n")
		if session.Location != "" {
			b.WriteString("LOCATION:" + icsEscape(session.Location) + "\r\n")
		}
		if session.VideoURL != "" {
			b.WriteString("URL:" + icsEscape(session.VideoURL) + "\r\n")
			b.WriteString("DESCRIPTION:" + icsEscape("Rejoindre la session : "+session.VideoURL) + "\r\n")
		}
		if session.Status == "CANCELLED" {
			b.WriteString("STATUS:CANCELLED\r\n")
		}
		b.WriteString("END:VEVENT\r\n")
	}
	b.WriteString("END:VCALENDAR\r\n")
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="lore-sessions.ics"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(b.String()))
}

// --- Curation du contenu (B-16) + annonces (B-18) ---------------------------

func (s *Server) listContentForReview(w http.ResponseWriter, r *http.Request) {
	contents, err := s.store.ListGeneratedContentForReview(r.Context(), r.PathValue("tenant_id"), r.URL.Query().Get("status"))
	respond(w, contents, err, http.StatusOK)
}

func (s *Server) reviewContent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if !decode(w, r, &req) {
		return
	}
	content, err := s.store.ReviewGeneratedContent(r.Context(), r.PathValue("tenant_id"), r.PathValue("content_id"), req.Status, req.Note, actorUserIDFromRequest(r))
	respond(w, content, err, http.StatusOK)
}

func (s *Server) createAnnouncement(w http.ResponseWriter, r *http.Request) {
	var req core.Announcement
	if !decode(w, r, &req) {
		return
	}
	req.TenantID = r.PathValue("tenant_id")
	announcement, err := s.store.CreateAnnouncement(r.Context(), req, actorUserIDFromRequest(r))
	respond(w, announcement, err, http.StatusCreated)
}

// listAnnouncements: a learner token only sees its cohorts' + tenant-wide.
func (s *Server) listAnnouncements(w http.ResponseWriter, r *http.Request) {
	learnerID := ""
	if claims, ok := r.Context().Value(claimsContextKey{}).(auth.Claims); ok && claims.Role == string(core.RoleLearner) {
		learnerID = claims.Subject
	}
	announcements, err := s.store.ListAnnouncements(r.Context(), r.PathValue("tenant_id"), learnerID)
	respond(w, announcements, err, http.StatusOK)
}

func (s *Server) archiveAnnouncement(w http.ResponseWriter, r *http.Request) {
	announcement, err := s.store.ArchiveAnnouncement(r.Context(), r.PathValue("tenant_id"), r.PathValue("announcement_id"), actorUserIDFromRequest(r))
	respond(w, announcement, err, http.StatusOK)
}

// --- Financeurs + BPF (B-15) -------------------------------------------------

func (s *Server) createFundingFile(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageFinance) {
		return
	}
	var req core.FundingFile
	if !decode(w, r, &req) {
		return
	}
	req.TenantID = tenantID
	file, err := s.store.CreateFundingFile(r.Context(), req, actorUserIDFromRequest(r))
	respond(w, file, err, http.StatusCreated)
}

func (s *Server) listFundingFiles(w http.ResponseWriter, r *http.Request) {
	files, err := s.store.ListFundingFiles(r.Context(), r.PathValue("tenant_id"), r.URL.Query().Get("learner_id"))
	respond(w, files, err, http.StatusOK)
}

func (s *Server) updateFundingFile(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageFinance) {
		return
	}
	var patch core.FundingFilePatch
	if !decode(w, r, &patch) {
		return
	}
	file, err := s.store.UpdateFundingFile(r.Context(), tenantID, r.PathValue("file_id"), patch, actorUserIDFromRequest(r))
	respond(w, file, err, http.StatusOK)
}

func (s *Server) archiveFundingFile(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageFinance) {
		return
	}
	file, err := s.store.ArchiveFundingFile(r.Context(), tenantID, r.PathValue("file_id"), actorUserIDFromRequest(r))
	respond(w, file, err, http.StatusOK)
}

func (s *Server) bpfExport(w http.ResponseWriter, r *http.Request) {
	year, err := strconv.Atoi(r.URL.Query().Get("year"))
	if err != nil || year < 2000 || year > 2200 {
		problem(w, http.StatusBadRequest, "year query parameter is required (e.g. ?year=2026)")
		return
	}
	report, err := s.store.BPFExport(r.Context(), r.PathValue("tenant_id"), year)
	respond(w, report, err, http.StatusOK)
}

// --- Textes légaux + consentements (B-28) ------------------------------------

func (s *Server) publishLegalText(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageLegal) {
		return
	}
	var req core.LegalText
	if !decode(w, r, &req) {
		return
	}
	req.TenantID = tenantID
	text, err := s.store.PublishLegalText(r.Context(), req, actorUserIDFromRequest(r))
	respond(w, text, err, http.StatusCreated)
}

func (s *Server) listLegalTexts(w http.ResponseWriter, r *http.Request) {
	history := r.URL.Query().Get("history") == "1"
	// Learners only ever need the current texts.
	if claims, ok := r.Context().Value(claimsContextKey{}).(auth.Claims); ok && claims.Role == string(core.RoleLearner) {
		history = false
	}
	texts, err := s.store.ListLegalTexts(r.Context(), r.PathValue("tenant_id"), history)
	respond(w, texts, err, http.StatusOK)
}

// recordConsent: identity always comes from the token when present — a
// learner cannot consent on behalf of someone else.
func (s *Server) recordConsent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		LegalTextID string `json:"legal_text_id"`
		UserID      string `json:"user_id"`
	}
	if !decode(w, r, &req) {
		return
	}
	userID := req.UserID
	if claims, ok := r.Context().Value(claimsContextKey{}).(auth.Claims); ok && claims.Subject != "" {
		userID = claims.Subject
	}
	if userID == "" {
		problem(w, http.StatusBadRequest, "user_id is required")
		return
	}
	consent, err := s.store.RecordConsent(r.Context(), r.PathValue("tenant_id"), userID, req.LegalTextID)
	respond(w, consent, err, http.StatusCreated)
}

// listConsents: staff read the registre; a learner token is narrowed to its
// own consents regardless of the query parameter.
func (s *Server) listConsents(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if claims, ok := r.Context().Value(claimsContextKey{}).(auth.Claims); ok && claims.Role == string(core.RoleLearner) {
		userID = claims.Subject
	}
	consents, err := s.store.ListConsents(r.Context(), r.PathValue("tenant_id"), userID)
	respond(w, consents, err, http.StatusOK)
}

// learnerPositioning (B-13): the archivable initial-positioning record — the
// first corrected assessment per concept (date, score, items). Trainers
// comment via the admin audit log (action positioning.comment).
func (s *Server) learnerPositioning(w http.ResponseWriter, r *http.Request) {
	// Defense in depth: a learner token may only read ITS positioning even if
	// the route allowlist ever opens this path to learners.
	if !s.authorizeLearnerCommand(w, r, r.PathValue("learner_id")) {
		return
	}
	evidence, err := s.store.ListPositioningEvidence(r.Context(), r.PathValue("tenant_id"), r.PathValue("learner_id"), r.URL.Query().Get("domain_id"))
	respond(w, evidence, err, http.StatusOK)
}

// --- Documents contractuels OF (B-10) ---------------------------------------

func (s *Server) createDocument(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageDocuments) {
		return
	}
	var req core.OFDocument
	if !decode(w, r, &req) {
		return
	}
	req.TenantID = tenantID
	doc, err := s.store.CreateDocument(r.Context(), req, actorUserIDFromRequest(r))
	respond(w, doc, err, http.StatusCreated)
}

// listDocuments: staff see everything; a learner token is forced onto its own
// scope (its documents + its cohorts' + tenant-wide ones like the règlement).
func (s *Server) listDocuments(w http.ResponseWriter, r *http.Request) {
	learnerID := r.URL.Query().Get("learner_id")
	if claims, ok := r.Context().Value(claimsContextKey{}).(auth.Claims); ok && claims.Role == string(core.RoleLearner) {
		learnerID = claims.Subject
	}
	documents, err := s.store.ListDocuments(r.Context(), r.PathValue("tenant_id"), learnerID)
	respond(w, documents, err, http.StatusOK)
}

func (s *Server) getDocument(w http.ResponseWriter, r *http.Request) {
	doc, err := s.store.GetDocument(r.Context(), r.PathValue("tenant_id"), r.PathValue("document_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	// A learner may only read a document in its scope: addressed to it,
	// addressed to one of its ACTIVE cohorts, or tenant-wide.
	if claims, ok := r.Context().Value(claimsContextKey{}).(auth.Claims); ok && claims.Role == string(core.RoleLearner) {
		allowed := false
		switch {
		case doc.LearnerID == claims.Subject:
			allowed = true
		case doc.LearnerID == "" && doc.CohortID == "":
			allowed = true
		case doc.LearnerID == "" && doc.CohortID != "":
			allowed = s.learnerIsEnrolled(r.Context(), doc.TenantID, doc.CohortID, claims.Subject)
		}
		if !allowed {
			problem(w, http.StatusForbidden, "document is not addressed to this learner")
			return
		}
	}
	writeJSON(w, http.StatusOK, doc)
}

func (s *Server) newDocumentVersion(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageDocuments) {
		return
	}
	var req struct {
		Title string `json:"title"`
		Body  string `json:"body"`
	}
	if !decode(w, r, &req) {
		return
	}
	doc, err := s.store.NewDocumentVersion(r.Context(), tenantID, r.PathValue("document_id"), req.Title, req.Body, actorUserIDFromRequest(r))
	respond(w, doc, err, http.StatusCreated)
}

func (s *Server) archiveDocument(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageDocuments) {
		return
	}
	doc, err := s.store.ArchiveDocument(r.Context(), tenantID, r.PathValue("document_id"), actorUserIDFromRequest(r))
	respond(w, doc, err, http.StatusOK)
}

// --- Banque de questions & devoirs (B-26) -----------------------------------

func (s *Server) createBankQuestion(w http.ResponseWriter, r *http.Request) {
	var req core.BankQuestion
	if !decode(w, r, &req) {
		return
	}
	req.TenantID = r.PathValue("tenant_id")
	question, err := s.store.CreateBankQuestion(r.Context(), req, actorUserIDFromRequest(r))
	respond(w, question, err, http.StatusCreated)
}

func (s *Server) listBankQuestions(w http.ResponseWriter, r *http.Request) {
	questions, err := s.store.ListBankQuestions(r.Context(), r.PathValue("tenant_id"), r.URL.Query().Get("concept_id"))
	respond(w, questions, err, http.StatusOK)
}

func (s *Server) archiveBankQuestion(w http.ResponseWriter, r *http.Request) {
	question, err := s.store.ArchiveBankQuestion(r.Context(), r.PathValue("tenant_id"), r.PathValue("question_id"), actorUserIDFromRequest(r))
	respond(w, question, err, http.StatusOK)
}

func (s *Server) createAssignment(w http.ResponseWriter, r *http.Request) {
	var req core.Assignment
	if !decode(w, r, &req) {
		return
	}
	req.TenantID = r.PathValue("tenant_id")
	req.CohortID = r.PathValue("cohort_id")
	assignment, err := s.store.CreateAssignment(r.Context(), req, actorUserIDFromRequest(r))
	respond(w, assignment, err, http.StatusCreated)
}

func (s *Server) listAssignments(w http.ResponseWriter, r *http.Request) {
	assignments, err := s.store.ListAssignments(r.Context(), r.PathValue("tenant_id"), r.URL.Query().Get("cohort_id"))
	respond(w, assignments, err, http.StatusOK)
}

// learnerIsEnrolled reports whether the learner has an ACTIVE enrollment in
// the cohort — the IDOR guard for learner-driven writes on cohort artefacts.
func (s *Server) learnerIsEnrolled(ctx context.Context, tenantID, cohortID, learnerID string) bool {
	enrollments, err := s.store.ListCohortEnrollments(ctx, tenantID, cohortID)
	if err != nil {
		return false
	}
	for _, enrollment := range enrollments {
		if enrollment.LearnerID == learnerID && enrollment.Status == "ACTIVE" {
			return true
		}
	}
	return false
}

func (s *Server) submitAssignment(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	var req struct {
		LearnerID string `json:"learner_id"`
		Content   string `json:"content"`
	}
	if !decode(w, r, &req) {
		return
	}
	if !s.authorizeLearnerCommand(w, r, req.LearnerID) {
		return
	}
	assignment, err := s.store.GetAssignment(r.Context(), tenantID, r.PathValue("assignment_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	// A learner token can only hand in work for a cohort it belongs to.
	if claims, ok := r.Context().Value(claimsContextKey{}).(auth.Claims); ok && claims.Role == string(core.RoleLearner) {
		if !s.learnerIsEnrolled(r.Context(), tenantID, assignment.CohortID, claims.Subject) {
			problem(w, http.StatusForbidden, "learner is not enrolled in this assignment's cohort")
			return
		}
	}
	submission, err := s.store.SubmitAssignment(r.Context(), core.AssignmentSubmission{
		TenantID:     tenantID,
		AssignmentID: assignment.ID,
		LearnerID:    req.LearnerID,
		Content:      req.Content,
	})
	respond(w, submission, err, http.StatusCreated)
}

func (s *Server) listAssignmentSubmissions(w http.ResponseWriter, r *http.Request) {
	submissions, err := s.store.ListAssignmentSubmissions(r.Context(), r.PathValue("tenant_id"), r.PathValue("assignment_id"))
	respond(w, submissions, err, http.StatusOK)
}

// gradeSubmission stores the manual grade and, when the assignment is bound to
// a concept, bridges the score into the runtime as corrected evidence (B-26).
func (s *Server) gradeSubmission(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	var req struct {
		Score    float64 `json:"score"`
		Feedback string  `json:"feedback"`
	}
	if !decode(w, r, &req) {
		return
	}
	grader := actorUserIDFromRequest(r)
	submission, err := s.store.GradeAssignmentSubmission(r.Context(), tenantID, r.PathValue("submission_id"), req.Score, req.Feedback, grader)
	if err != nil {
		handleError(w, err)
		return
	}
	var bridged *core.StateDelta
	if assignment, err := s.store.GetAssignment(r.Context(), tenantID, submission.AssignmentID); err == nil &&
		assignment.ConceptID != "" && assignment.DomainID != "" {
		delta, bridgeErr := s.engine.RecordManualEvidence(r.Context(), runtime.ManualEvidenceCommand{
			TenantID:  tenantID,
			LearnerID: submission.LearnerID,
			DomainID:  assignment.DomainID,
			ConceptID: assignment.ConceptID,
			Score:     req.Score,
			GraderID:  grader,
			SourceRef: submission.ID,
		})
		if bridgeErr == nil {
			bridged = &delta
			s.invalidateLearnerState(r.Context(), tenantID, submission.LearnerID)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"submission": submission, "state_delta": bridged})
}

// --- Profil OF + dossier Qualiopi (B-08/B-09) -------------------------------

func (s *Server) getTenantProfile(w http.ResponseWriter, r *http.Request) {
	tenant, err := s.store.GetTenant(r.Context(), r.PathValue("tenant_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	if tenant.Profile == nil {
		tenant.Profile = map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"tenant_id": tenant.ID, "name": tenant.Name, "profile": tenant.Profile})
}

func (s *Server) updateTenantProfile(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageDocuments) {
		return
	}
	var req struct {
		Profile map[string]any `json:"profile"`
	}
	if !decode(w, r, &req) {
		return
	}
	tenant, err := s.store.UpdateTenantProfile(r.Context(), tenantID, req.Profile, actorUserIDFromRequest(r))
	respond(w, tenant, err, http.StatusOK)
}

// qualiopiExport (B-08) assembles the audit-ready evidence bundle for one
// cohort: identity, sessions, per-learner progress/hours, satisfaction
// aggregates and the complaints register. JSON on purpose — the web tier
// renders the human-readable dossier; this is the canonical data.
func (s *Server) qualiopiExport(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := r.PathValue("tenant_id")
	cohortID := r.PathValue("cohort_id")
	tenant, err := s.store.GetTenant(ctx, tenantID)
	if err != nil {
		handleError(w, err)
		return
	}
	progress, err := s.store.CohortProgress(ctx, tenantID, cohortID, runtime.MasteryThreshold)
	if err != nil {
		handleError(w, err)
		return
	}
	analytics, err := s.store.CohortAnalytics(ctx, tenantID, cohortID)
	if err != nil {
		handleError(w, err)
		return
	}
	sessions, err := s.store.ListTrainingSessions(ctx, tenantID, cohortID)
	if err != nil {
		handleError(w, err)
		return
	}
	learners, err := s.store.ListLearners(ctx, tenantID)
	if err != nil {
		handleError(w, err)
		return
	}
	nameByID := make(map[string]string, len(learners))
	for _, learner := range learners {
		nameByID[learner.UserID] = learner.Name
	}
	type progressRow struct {
		core.LearnerProgressSummary
		LearnerName string `json:"learner_name,omitempty"`
	}
	progressRows := make([]progressRow, 0, len(progress))
	for _, row := range progress {
		progressRows = append(progressRows, progressRow{LearnerProgressSummary: row, LearnerName: nameByID[row.LearnerID]})
	}

	surveys, err := s.store.ListSurveys(ctx, tenantID, cohortID)
	if err != nil {
		handleError(w, err)
		return
	}
	type surveySummary struct {
		Survey        core.SatisfactionSurvey `json:"survey"`
		ResponseCount int                     `json:"response_count"`
		ScaleAverages map[string]float64      `json:"scale_averages"`
	}
	surveySummaries := make([]surveySummary, 0, len(surveys))
	for _, survey := range surveys {
		responses, err := s.store.ListSurveyResponses(ctx, tenantID, survey.ID)
		if err != nil {
			handleError(w, err)
			return
		}
		sums := map[string]float64{}
		counts := map[string]int{}
		for _, response := range responses {
			for qid, value := range response.Answers {
				if n, ok := value.(float64); ok {
					sums[qid] += n
					counts[qid]++
				}
			}
		}
		averages := map[string]float64{}
		for qid, sum := range sums {
			if counts[qid] > 0 {
				averages[qid] = sum / float64(counts[qid])
			}
		}
		surveySummaries = append(surveySummaries, surveySummary{Survey: survey, ResponseCount: len(responses), ScaleAverages: averages})
	}

	complaints, err := s.store.ListComplaints(ctx, tenantID)
	if err != nil {
		handleError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"generated_at": time.Now().UTC(),
		"generated_by": actorUserIDFromRequest(r),
		"organisme": map[string]any{
			"tenant_id": tenant.ID,
			"name":      tenant.Name,
			"profile":   tenant.Profile,
		},
		"cohort_id":    cohortID,
		"analytics":    analytics,
		"sessions":     sessions,
		"progress":     progressRows,
		"satisfaction": surveySummaries,
		"complaints":   complaints,
	})
}

// --- Satisfaction & réclamations (B-11) ------------------------------------

func (s *Server) createSurvey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Kind      string                `json:"kind"`
		Title     string                `json:"title"`
		Questions []core.SurveyQuestion `json:"questions"`
		OpensAt   *time.Time            `json:"opens_at"`
		ClosesAt  *time.Time            `json:"closes_at"`
	}
	if !decode(w, r, &req) {
		return
	}
	survey, err := s.store.CreateSurvey(r.Context(), core.SatisfactionSurvey{
		TenantID:  r.PathValue("tenant_id"),
		CohortID:  r.PathValue("cohort_id"),
		Kind:      req.Kind,
		Title:     req.Title,
		Questions: req.Questions,
		OpensAt:   req.OpensAt,
		ClosesAt:  req.ClosesAt,
	}, actorUserIDFromRequest(r))
	respond(w, survey, err, http.StatusCreated)
}

func (s *Server) listSurveys(w http.ResponseWriter, r *http.Request) {
	surveys, err := s.store.ListSurveys(r.Context(), r.PathValue("tenant_id"), r.URL.Query().Get("cohort_id"))
	respond(w, surveys, err, http.StatusOK)
}

func (s *Server) getSurvey(w http.ResponseWriter, r *http.Request) {
	survey, err := s.store.GetSurvey(r.Context(), r.PathValue("tenant_id"), r.PathValue("survey_id"))
	respond(w, survey, err, http.StatusOK)
}

func (s *Server) submitSurveyResponse(w http.ResponseWriter, r *http.Request) {
	var req struct {
		LearnerID string         `json:"learner_id"`
		Answers   map[string]any `json:"answers"`
	}
	if !decode(w, r, &req) {
		return
	}
	if !s.authorizeLearnerCommand(w, r, req.LearnerID) {
		return
	}
	tenantID := r.PathValue("tenant_id")
	// Same IDOR guard as assignments: only enrolled learners answer a
	// cohort's survey (staff tokens may submit on someone's behalf).
	if claims, ok := r.Context().Value(claimsContextKey{}).(auth.Claims); ok && claims.Role == string(core.RoleLearner) {
		survey, err := s.store.GetSurvey(r.Context(), tenantID, r.PathValue("survey_id"))
		if err != nil {
			handleError(w, err)
			return
		}
		if !s.learnerIsEnrolled(r.Context(), tenantID, survey.CohortID, claims.Subject) {
			problem(w, http.StatusForbidden, "learner is not enrolled in this survey's cohort")
			return
		}
	}
	response, err := s.store.SubmitSurveyResponse(r.Context(), core.SurveyResponse{
		TenantID:  tenantID,
		SurveyID:  r.PathValue("survey_id"),
		LearnerID: req.LearnerID,
		Answers:   req.Answers,
	})
	respond(w, response, err, http.StatusCreated)
}

func (s *Server) listSurveyResponses(w http.ResponseWriter, r *http.Request) {
	responses, err := s.store.ListSurveyResponses(r.Context(), r.PathValue("tenant_id"), r.PathValue("survey_id"))
	respond(w, responses, err, http.StatusOK)
}

func (s *Server) createComplaint(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OpenedBy    string `json:"opened_by"`
		LearnerID   string `json:"learner_id"`
		Subject     string `json:"subject"`
		Description string `json:"description"`
	}
	if !decode(w, r, &req) {
		return
	}
	// A learner token can only open a complaint as ITSELF — identity comes
	// from the verified claims, never the body (impersonation in the RNQ
	// register would taint the evidence). Staff may file on someone's behalf.
	openedBy, learnerID := req.OpenedBy, req.LearnerID
	if claims, ok := r.Context().Value(claimsContextKey{}).(auth.Claims); ok && claims.Role == string(core.RoleLearner) {
		openedBy = claims.Subject
		learnerID = claims.Subject
	}
	complaint, err := s.store.CreateComplaint(r.Context(), core.Complaint{
		TenantID:    r.PathValue("tenant_id"),
		OpenedBy:    openedBy,
		LearnerID:   learnerID,
		Subject:     req.Subject,
		Description: req.Description,
	})
	respond(w, complaint, err, http.StatusCreated)
}

func (s *Server) listComplaints(w http.ResponseWriter, r *http.Request) {
	complaints, err := s.store.ListComplaints(r.Context(), r.PathValue("tenant_id"))
	respond(w, complaints, err, http.StatusOK)
}

func (s *Server) updateComplaint(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageQuality) {
		return
	}
	var req struct {
		Status     string `json:"status"`
		Resolution string `json:"resolution"`
	}
	if !decode(w, r, &req) {
		return
	}
	complaint, err := s.store.UpdateComplaint(r.Context(), tenantID, r.PathValue("complaint_id"), req.Status, req.Resolution, actorUserIDFromRequest(r))
	respond(w, complaint, err, http.StatusOK)
}

// eraseLearnerData (B-14) purges every runtime trace of one learner in this
// tenant and tombstones the identity. Admin-only and irreversible — the audit
// log records the action with row counts but no personal data.
func (s *Server) eraseLearnerData(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capEraseData) {
		return
	}
	learnerID := r.PathValue("learner_id")
	counts, err := s.store.EraseLearnerData(r.Context(), tenantID, learnerID, actorUserIDFromRequest(r))
	if err != nil {
		handleError(w, err)
		return
	}
	s.invalidateLearnerState(r.Context(), tenantID, learnerID)
	writeJSON(w, http.StatusOK, map[string]any{"erased": counts})
}

// --- Cohort invites (B-23) -------------------------------------------------

func (s *Server) createCohortInvite(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageEnrollments) {
		return
	}
	var req struct {
		ExpiresInHours int `json:"expires_in_hours"`
		MaxUses        int `json:"max_uses"`
	}
	if !decode(w, r, &req) {
		return
	}
	var expiresAt *time.Time
	if req.ExpiresInHours > 0 {
		t := time.Now().UTC().Add(time.Duration(req.ExpiresInHours) * time.Hour)
		expiresAt = &t
	}
	invite, err := s.store.CreateCohortInvite(r.Context(), tenantID, r.PathValue("cohort_id"), expiresAt, req.MaxUses, actorUserIDFromRequest(r))
	respond(w, invite, err, http.StatusCreated)
}

func (s *Server) listCohortInvites(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageEnrollments) {
		return
	}
	invites, err := s.store.ListCohortInvites(r.Context(), tenantID, r.PathValue("cohort_id"))
	respond(w, invites, err, http.StatusOK)
}

func (s *Server) revokeCohortInvite(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if !s.authorizeCapability(w, r, tenantID, capManageEnrollments) {
		return
	}
	invite, err := s.store.RevokeCohortInvite(r.Context(), tenantID, r.PathValue("invite_id"), actorUserIDFromRequest(r))
	respond(w, invite, err, http.StatusOK)
}

// lookupInvite is the PUBLIC landing read: the unguessable code is the only
// credential. It never returns the counters — just enough to render the join
// page (organisation + cohort names and whether the invite is still usable).
func (s *Server) lookupInvite(w http.ResponseWriter, r *http.Request) {
	invite, err := s.store.GetCohortInviteByCode(r.Context(), r.PathValue("code"))
	if err != nil {
		handleError(w, err)
		return
	}
	usable := inviteUsableForResponse(invite)
	writeJSON(w, http.StatusOK, map[string]any{
		"tenant_id":   invite.TenantID,
		"tenant_name": invite.TenantName,
		"cohort_id":   invite.CohortID,
		"cohort_name": invite.CohortName,
		"usable":      usable == "",
		"reason":      usable,
	})
}

func inviteUsableForResponse(invite core.CohortInvite) string {
	now := time.Now().UTC()
	switch {
	case invite.RevokedAt != nil:
		return "invitation révoquée"
	case invite.ExpiresAt != nil && now.After(*invite.ExpiresAt):
		return "invitation expirée"
	case invite.MaxUses > 0 && invite.UseCount >= invite.MaxUses:
		return "invitation épuisée"
	default:
		return ""
	}
}

// redeemInvite is called by the TRUSTED web tier (bootstrap secret) after it
// has provisioned the user: it grants the LEARNER membership, enrolls into the
// cohort and burns one use — the code is never accepted from an end user here.
func (s *Server) redeemInvite(w http.ResponseWriter, r *http.Request) {
	if !s.callerIsBootstrap(r) {
		problem(w, http.StatusForbidden, "invite redemption is reserved to the trusted web tier")
		return
	}
	var req struct {
		UserID string `json:"user_id"`
	}
	if !decode(w, r, &req) {
		return
	}
	if req.UserID == "" {
		problem(w, http.StatusBadRequest, "user_id is required")
		return
	}
	invite, err := s.store.ConsumeCohortInvite(r.Context(), r.PathValue("code"))
	if err != nil {
		handleError(w, err)
		return
	}
	if _, err := s.store.AddMembership(r.Context(), invite.TenantID, req.UserID, core.RoleLearner); err != nil {
		handleError(w, err)
		return
	}
	enrollment, err := s.store.EnrollLearner(r.Context(), invite.TenantID, invite.CohortID, req.UserID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"tenant_id":  invite.TenantID,
		"cohort_id":  invite.CohortID,
		"enrollment": enrollment,
	})
}

// --- Course modules (B-24) -------------------------------------------------
// Modules are authored by trainers/admins (middleware already restricts
// learners); the learner path is evidence-only and readable by its learner.

func (s *Server) createCourseModule(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title           string   `json:"title"`
		Description     string   `json:"description"`
		Position        int      `json:"position"`
		ConceptIDs      []string `json:"concept_ids"`
		PrerequisiteIDs []string `json:"prerequisite_ids"`
		RequiredMastery float64  `json:"required_mastery"`
	}
	if !decode(w, r, &req) {
		return
	}
	module, err := s.store.CreateCourseModule(r.Context(), core.CourseModule{
		TenantID:        r.PathValue("tenant_id"),
		SyllabusID:      r.PathValue("syllabus_id"),
		Title:           req.Title,
		Description:     req.Description,
		Position:        req.Position,
		ConceptIDs:      req.ConceptIDs,
		PrerequisiteIDs: req.PrerequisiteIDs,
		RequiredMastery: req.RequiredMastery,
	}, actorUserIDFromRequest(r))
	respond(w, module, err, http.StatusCreated)
}

func (s *Server) listCourseModules(w http.ResponseWriter, r *http.Request) {
	modules, err := s.store.ListCourseModules(r.Context(), r.PathValue("tenant_id"), r.PathValue("syllabus_id"))
	respond(w, modules, err, http.StatusOK)
}

func (s *Server) updateCourseModule(w http.ResponseWriter, r *http.Request) {
	var patch core.CourseModulePatch
	if !decode(w, r, &patch) {
		return
	}
	module, err := s.store.UpdateCourseModule(r.Context(), r.PathValue("tenant_id"), r.PathValue("module_id"), patch, actorUserIDFromRequest(r))
	respond(w, module, err, http.StatusOK)
}

func (s *Server) archiveCourseModule(w http.ResponseWriter, r *http.Request) {
	module, err := s.store.ArchiveCourseModule(r.Context(), r.PathValue("tenant_id"), r.PathValue("module_id"), actorUserIDFromRequest(r))
	respond(w, module, err, http.StatusOK)
}

func (s *Server) learnerModulePath(w http.ResponseWriter, r *http.Request) {
	syllabusID := r.URL.Query().Get("syllabus_id")
	if syllabusID == "" {
		problem(w, http.StatusBadRequest, "syllabus_id query parameter is required")
		return
	}
	path, err := s.store.LearnerModulePath(r.Context(), r.PathValue("tenant_id"), r.PathValue("learner_id"), syllabusID)
	respond(w, path, err, http.StatusOK)
}

func (s *Server) bindSyllabus(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TargetType     string `json:"target_type"`
		TargetID       string `json:"target_id"`
		AdaptationMode string `json:"adaptation_mode"`
	}
	if !decode(w, r, &req) {
		return
	}
	binding, err := s.store.BindSyllabus(r.Context(), r.PathValue("tenant_id"), r.PathValue("syllabus_id"), req.TargetType, req.TargetID, req.AdaptationMode)
	respond(w, binding, err, http.StatusCreated)
}

func (s *Server) listDomains(w http.ResponseWriter, r *http.Request) {
	domains, err := s.store.ListDomains(r.Context(), r.PathValue("tenant_id"))
	respond(w, domains, err, http.StatusOK)
}

func (s *Server) createDomain(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OwnerID      string                 `json:"owner_id"`
		Name         string                 `json:"name"`
		Description  string                 `json:"description"`
		Source       string                 `json:"source"`
		Concepts     []core.ConceptDraft    `json:"concepts"`
		Dependencies []core.DependencyDraft `json:"dependencies"`
	}
	if !decode(w, r, &req) {
		return
	}
	graph, err := s.store.CreateDomain(r.Context(), r.PathValue("tenant_id"), req.OwnerID, req.Name, req.Description, req.Source, req.Concepts, req.Dependencies)
	respond(w, graph, err, http.StatusCreated)
}

func (s *Server) replaceDomainGraph(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Concepts     []core.ConceptDraft    `json:"concepts"`
		Dependencies []core.DependencyDraft `json:"dependencies"`
	}
	if !decode(w, r, &req) {
		return
	}
	graph, err := s.store.ReplaceDomainGraph(r.Context(), r.PathValue("tenant_id"), r.PathValue("domain_id"), req.Concepts, req.Dependencies)
	respond(w, graph, err, http.StatusOK)
}

func (s *Server) getDomain(w http.ResponseWriter, r *http.Request) {
	graph, err := s.store.GetDomainGraph(r.Context(), r.PathValue("tenant_id"), r.PathValue("domain_id"))
	respond(w, graph, err, http.StatusOK)
}

func (s *Server) nextActivity(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DomainID          string   `json:"domain_id"`
		Intent            string   `json:"intent"`
		AllowedConceptIDs []string `json:"allowed_concept_ids"`
	}
	if !decode(w, r, &req) {
		return
	}
	decision, err := s.engine.PlanNext(r.Context(), runtime.PlanNextInput{
		TenantID:          r.PathValue("tenant_id"),
		LearnerID:         r.PathValue("learner_id"),
		DomainID:          req.DomainID,
		Intent:            req.Intent,
		AllowedConceptIDs: req.AllowedConceptIDs,
	})
	respond(w, decision, err, http.StatusCreated)
}

// authorizeActivityOwner blocks a learner token from driving another learner's
// activity clock (staff tokens pass). Returns false after writing the problem.
func (s *Server) authorizeActivityOwner(w http.ResponseWriter, r *http.Request, tenantID, activityID string) bool {
	activity, _, err := s.store.GetActivity(r.Context(), tenantID, activityID)
	if err != nil {
		handleError(w, err)
		return false
	}
	return s.authorizeLearnerCommand(w, r, activity.LearnerID)
}

func (s *Server) startActivity(w http.ResponseWriter, r *http.Request) {
	tenantID, activityID := r.PathValue("tenant_id"), r.PathValue("activity_id")
	if !s.authorizeActivityOwner(w, r, tenantID, activityID) {
		return
	}
	activity, err := s.store.StartActivity(r.Context(), tenantID, activityID)
	respond(w, activity, err, http.StatusOK)
}

func (s *Server) pauseActivity(w http.ResponseWriter, r *http.Request) {
	tenantID, activityID := r.PathValue("tenant_id"), r.PathValue("activity_id")
	if !s.authorizeActivityOwner(w, r, tenantID, activityID) {
		return
	}
	activity, err := s.store.PauseActivity(r.Context(), tenantID, activityID)
	respond(w, activity, err, http.StatusOK)
}

func (s *Server) resumeActivity(w http.ResponseWriter, r *http.Request) {
	tenantID, activityID := r.PathValue("tenant_id"), r.PathValue("activity_id")
	if !s.authorizeActivityOwner(w, r, tenantID, activityID) {
		return
	}
	activity, err := s.store.ResumeActivity(r.Context(), tenantID, activityID)
	respond(w, activity, err, http.StatusOK)
}

func (s *Server) recordInteraction(w http.ResponseWriter, r *http.Request) {
	var req core.InteractionCommand
	if !decode(w, r, &req) {
		return
	}
	req.TenantID = r.PathValue("tenant_id")
	if !s.authorizeLearnerCommand(w, r, req.LearnerID) {
		return
	}
	if !s.allowRawInteraction(w, r, req) {
		return
	}
	if s.recordInteractionIdempotently(w, r, req) {
		return
	}
	delta, err := s.engine.RecordInteraction(r.Context(), req)
	if err == nil {
		s.invalidateLearnerState(r.Context(), req.TenantID, req.LearnerID)
	}
	respond(w, delta, err, http.StatusCreated)
}

func (s *Server) planAssessment(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DomainID string `json:"domain_id"`
	}
	if !decode(w, r, &req) {
		return
	}
	decision, err := s.engine.PlanNext(r.Context(), runtime.PlanNextInput{
		TenantID:  r.PathValue("tenant_id"),
		LearnerID: r.PathValue("learner_id"),
		DomainID:  req.DomainID,
		Intent:    "assessment",
	})
	respond(w, decision, err, http.StatusCreated)
}

func (s *Server) submitAssessment(w http.ResponseWriter, r *http.Request) {
	var req core.AssessmentSubmissionCommand
	if !decode(w, r, &req) {
		return
	}
	req.TenantID = r.PathValue("tenant_id")
	req.ActivityID = r.PathValue("activity_id")
	if !s.authorizeLearnerCommand(w, r, req.LearnerID) {
		return
	}
	if s.submitAssessmentIdempotently(w, r, req) {
		return
	}
	delta, err := s.engine.SubmitAssessment(r.Context(), req)
	if err == nil {
		s.invalidateLearnerState(r.Context(), req.TenantID, req.LearnerID)
	}
	respond(w, delta, err, http.StatusCreated)
}

func (s *Server) allowRawInteraction(w http.ResponseWriter, r *http.Request, req core.InteractionCommand) bool {
	activity, _, err := s.store.GetActivity(r.Context(), req.TenantID, req.ActivityID)
	if err != nil {
		handleError(w, err)
		return false
	}
	if activity.ActivityType == core.ActivityAssessment {
		problem(w, http.StatusBadRequest, "assessment activities must be submitted through the corrected assessment endpoint")
		return false
	}
	return true
}

func (s *Server) recordInteractionIdempotently(w http.ResponseWriter, r *http.Request, req core.InteractionCommand) bool {
	idempotencyKey := strings.TrimSpace(r.Header.Get(idempotencyKeyHeader))
	if idempotencyKey == "" {
		return false
	}
	if len(idempotencyKey) > 255 {
		problem(w, http.StatusBadRequest, "idempotency key must be 255 characters or fewer")
		return true
	}
	record, err := s.store.GetIdempotencyRecord(r.Context(), req.TenantID, idempotencyKey)
	if err == nil {
		writeIdempotencyReplay(w, record)
		return true
	}
	if !errors.Is(err, core.ErrNotFound) {
		handleError(w, err)
		return true
	}

	delta, completed, err := s.engine.PrepareInteractionDelta(r.Context(), req)
	if err != nil {
		handleError(w, err)
		return true
	}
	response, err := json.Marshal(delta)
	if err != nil {
		handleError(w, err)
		return true
	}
	record = core.IdempotencyRecord{
		TenantID:   req.TenantID,
		Key:        idempotencyKey,
		StatusCode: http.StatusCreated,
		Response:   response,
		CreatedAt:  delta.Interaction.CreatedAt,
	}
	err = s.store.SaveInteractionDeltaIdempotent(r.Context(), delta, completed, record)
	if errors.Is(err, core.ErrConflict) {
		record, replayErr := s.store.GetIdempotencyRecord(r.Context(), req.TenantID, idempotencyKey)
		if replayErr != nil {
			handleError(w, replayErr)
			return true
		}
		writeIdempotencyReplay(w, record)
		return true
	}
	if err != nil {
		handleError(w, err)
		return true
	}
	s.invalidateLearnerState(r.Context(), req.TenantID, req.LearnerID)
	writeRawJSON(w, http.StatusCreated, response)
	return true
}

func (s *Server) submitAssessmentIdempotently(w http.ResponseWriter, r *http.Request, req core.AssessmentSubmissionCommand) bool {
	idempotencyKey := strings.TrimSpace(r.Header.Get(idempotencyKeyHeader))
	if idempotencyKey == "" {
		return false
	}
	if len(idempotencyKey) > 255 {
		problem(w, http.StatusBadRequest, "idempotency key must be 255 characters or fewer")
		return true
	}
	record, err := s.store.GetIdempotencyRecord(r.Context(), req.TenantID, idempotencyKey)
	if err == nil {
		writeIdempotencyReplay(w, record)
		return true
	}
	if !errors.Is(err, core.ErrNotFound) {
		handleError(w, err)
		return true
	}

	delta, completed, err := s.engine.PrepareAssessmentSubmissionDelta(r.Context(), req)
	if err != nil {
		handleError(w, err)
		return true
	}
	response, err := json.Marshal(delta)
	if err != nil {
		handleError(w, err)
		return true
	}
	record = core.IdempotencyRecord{
		TenantID:   req.TenantID,
		Key:        idempotencyKey,
		StatusCode: http.StatusCreated,
		Response:   response,
		CreatedAt:  delta.Interaction.CreatedAt,
	}
	err = s.store.SaveInteractionDeltaIdempotent(r.Context(), delta, completed, record)
	if errors.Is(err, core.ErrConflict) {
		record, replayErr := s.store.GetIdempotencyRecord(r.Context(), req.TenantID, idempotencyKey)
		if replayErr != nil {
			handleError(w, replayErr)
			return true
		}
		writeIdempotencyReplay(w, record)
		return true
	}
	if err != nil {
		handleError(w, err)
		return true
	}
	s.invalidateLearnerState(r.Context(), req.TenantID, req.LearnerID)
	writeRawJSON(w, http.StatusCreated, response)
	return true
}

func (s *Server) learnerState(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	learnerID := r.PathValue("learner_id")
	if s.cache != nil {
		if data, err := s.cache.Get(r.Context(), learnerStateCacheKey(tenantID, learnerID)); err == nil {
			w.Header().Set("X-LORE-Cache", "hit")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(data)
			return
		}
	}
	state, err := s.engine.GetLearnerModel(r.Context(), tenantID, learnerID)
	if err == nil && s.cache != nil {
		if data, marshalErr := json.Marshal(state); marshalErr == nil {
			_ = s.cache.Set(r.Context(), learnerStateCacheKey(tenantID, learnerID), data, 30*time.Second)
		}
	}
	respond(w, state, err, http.StatusOK)
}

func (s *Server) dueReviews(w http.ResponseWriter, r *http.Request) {
	reviews, err := s.store.ListDueReviews(r.Context(), r.PathValue("tenant_id"), r.PathValue("learner_id"), time.Now().UTC())
	respond(w, reviews, err, http.StatusOK)
}

func (s *Server) snapshots(w http.ResponseWriter, r *http.Request) {
	snapshots, err := s.store.ListSnapshots(r.Context(), r.PathValue("tenant_id"), r.PathValue("learner_id"))
	respond(w, snapshots, err, http.StatusOK)
}

func (s *Server) getLLMConfig(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	scopeType, scopeID, ok := llmConfigScopeFromRequest(w, r)
	if !ok {
		return
	}
	config, err := s.store.GetLLMConfiguration(r.Context(), tenantID, scopeType, scopeID)
	if errors.Is(err, core.ErrNotFound) {
		config = s.defaultLLMConfig(tenantID)
		config.ScopeType = scopeType
		config.ScopeID = scopeID
	} else if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, publicLLMConfig(config))
}

func (s *Server) putLLMConfig(w http.ResponseWriter, r *http.Request) {
	var req core.LLMConfiguration
	if !decode(w, r, &req) {
		return
	}
	tenantID := r.PathValue("tenant_id")
	scopeType, scopeID, ok := llmConfigScopeFromRequest(w, r)
	if !ok {
		return
	}
	defaults := s.defaultLLMConfig(tenantID)
	config := core.LLMConfiguration{
		TenantID:    tenantID,
		ScopeType:   scopeType,
		ScopeID:     scopeID,
		Provider:    req.Provider,
		Model:       req.Model,
		BaseURL:     req.BaseURL,
		APIKey:      req.APIKey,
		Temperature: req.Temperature,
		MaxTokens:   req.MaxTokens,
		CreatedAt:   req.CreatedAt,
		UpdatedAt:   req.UpdatedAt,
	}
	if config.Provider == "" {
		config.Provider = defaults.Provider
	}
	if config.Model == "" {
		config.Model = defaults.Model
	}
	saved, err := s.store.SaveLLMConfiguration(r.Context(), config)
	respond(w, publicLLMConfig(saved), err, http.StatusOK)
}

func (s *Server) generateContent(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	instruction, err := s.store.GetInstruction(r.Context(), tenantID, r.PathValue("instruction_id"))
	if err != nil {
		respond(w, nil, err, http.StatusOK)
		return
	}
	content, err := s.generatorForInstruction(r.Context(), instruction, r).Generate(r.Context(), instruction)
	if err == nil {
		err = s.store.SaveGeneratedContent(r.Context(), content)
	}
	respond(w, content, err, http.StatusCreated)
}

func (s *Server) listGeneratedContent(w http.ResponseWriter, r *http.Request) {
	content, err := s.store.ListGeneratedContent(r.Context(), r.PathValue("tenant_id"), r.URL.Query().Get("instruction_id"))
	respond(w, content, err, http.StatusOK)
}

func (s *Server) getGeneratedContent(w http.ResponseWriter, r *http.Request) {
	content, err := s.store.GetGeneratedContent(r.Context(), r.PathValue("tenant_id"), r.PathValue("content_id"))
	respond(w, content, err, http.StatusOK)
}

func (s *Server) defaultLLMConfig(tenantID string) core.LLMConfiguration {
	s.configMu.RLock()
	defer s.configMu.RUnlock()
	return core.LLMConfiguration{TenantID: tenantID, ScopeType: "tenant", Provider: s.llmProvider, Model: s.llmModel}
}

func (s *Server) generatorForInstruction(ctx context.Context, instruction core.TutorInstruction, r *http.Request) llm.Generator {
	config := s.effectiveLLMConfig(ctx, instruction, r)
	if config.Provider == "" && config.Model == "" && config.BaseURL == "" && config.APIKey == "" {
		return s.generator
	}
	defaults := s.defaultLLMConfig(instruction.TenantID)
	if config.Provider == "" {
		config.Provider = defaults.Provider
	}
	if config.Model == "" {
		config.Model = defaults.Model
	}
	// Tenant-configurable base URLs are an SSRF vector: route remote provider
	// calls through a client that blocks private/loopback/link-local targets
	// and refuses redirects.
	return llm.NewGeneratorFromConfig(llm.ProviderConfig{
		Provider:      config.Provider,
		Model:         config.Model,
		OllamaBaseURL: config.BaseURL,
		BaseURL:       config.BaseURL,
		APIKey:        config.APIKey,
		Temperature:   config.Temperature,
		MaxTokens:     config.MaxTokens,
		Client:        llm.GuardedHTTPClient(20 * time.Second),
	})
}

func (s *Server) effectiveLLMConfig(ctx context.Context, instruction core.TutorInstruction, r *http.Request) core.LLMConfiguration {
	tenantID := instruction.TenantID
	queries := []struct {
		scopeType string
		scopeID   string
	}{
		{scopeType: "learner", scopeID: firstNonEmpty(r.URL.Query().Get("learner_id"), instruction.LearnerID)},
		{scopeType: "cohort", scopeID: r.URL.Query().Get("cohort_id")},
		{scopeType: "program", scopeID: r.URL.Query().Get("program_id")},
		{scopeType: "tenant", scopeID: ""},
	}
	for _, query := range queries {
		if query.scopeType != "tenant" && strings.TrimSpace(query.scopeID) == "" {
			continue
		}
		config, err := s.store.GetLLMConfiguration(ctx, tenantID, query.scopeType, strings.TrimSpace(query.scopeID))
		if err == nil {
			return config
		}
		if !errors.Is(err, core.ErrNotFound) {
			return core.LLMConfiguration{}
		}
	}
	return core.LLMConfiguration{}
}

func publicLLMConfig(config core.LLMConfiguration) core.LLMConfiguration {
	if config.APIKey != "" {
		config.APIKeyConfigured = true
	}
	config.APIKey = ""
	return config
}

func llmConfigScopeFromRequest(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	scopeType := strings.ToLower(strings.TrimSpace(firstNonEmpty(r.URL.Query().Get("scope_type"), "tenant")))
	scopeID := strings.TrimSpace(r.URL.Query().Get("scope_id"))
	switch scopeType {
	case "tenant":
		if scopeID != "" {
			problem(w, http.StatusBadRequest, "tenant-scoped LLM configuration must not set scope_id")
			return "", "", false
		}
		return "tenant", "", true
	case "program", "cohort", "learner":
		if scopeID == "" {
			problem(w, http.StatusBadRequest, "scope_id is required for program, cohort, and learner LLM configuration")
			return "", "", false
		}
		return scopeType, scopeID, true
	default:
		problem(w, http.StatusBadRequest, "scope_type must be tenant, program, cohort, or learner")
		return "", "", false
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func (s *Server) outboxEvents(w http.ResponseWriter, r *http.Request) {
	unpublishedOnly := r.URL.Query().Get("published") == "false" || r.URL.Query().Get("unpublished") == "true"
	events, err := s.store.ListEvents(r.Context(), r.PathValue("tenant_id"), unpublishedOnly)
	respond(w, events, err, http.StatusOK)
}

func (s *Server) markEventPublished(w http.ResponseWriter, r *http.Request) {
	event, err := s.store.MarkEventPublished(r.Context(), r.PathValue("tenant_id"), r.PathValue("event_id"), time.Now().UTC())
	respond(w, event, err, http.StatusOK)
}

func (s *Server) cohortAnalytics(w http.ResponseWriter, r *http.Request) {
	analytics, err := s.store.CohortAnalytics(r.Context(), r.PathValue("tenant_id"), r.PathValue("cohort_id"))
	respond(w, analytics, err, http.StatusOK)
}

func (s *Server) cohortTrainingTimeCSV(w http.ResponseWriter, r *http.Request) {
	analytics, err := s.store.CohortAnalytics(r.Context(), r.PathValue("tenant_id"), r.PathValue("cohort_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	rows, err := trainingTimeRows(analytics["learner_time"])
	if err != nil {
		handleError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="lore-training-time.csv"`)
	w.WriteHeader(http.StatusOK)
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"tenant_id", "program_id", "cohort_id", "learner_id", "activity_count", "training_time_seconds", "training_hours"})
	for _, row := range rows {
		_ = cw.Write([]string{
			row.TenantID,
			row.ProgramID,
			row.CohortID,
			row.LearnerID,
			strconv.Itoa(row.ActivityCount),
			strconv.FormatInt(row.TrainingTimeSeconds, 10),
			strconv.FormatFloat(row.TrainingHours, 'f', 4, 64),
		})
	}
	cw.Flush()
}

// cohortProgressCSV exports per-learner progress/completion evidence (B-12/B-22).
// "Mastered" uses the runtime's mastery threshold so the export matches what the
// learner-facing surfaces report.
func (s *Server) cohortProgressCSV(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.CohortProgress(r.Context(), r.PathValue("tenant_id"), r.PathValue("cohort_id"), runtime.MasteryThreshold)
	if err != nil {
		handleError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="lore-progress.csv"`)
	w.WriteHeader(http.StatusOK)
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"tenant_id", "cohort_id", "learner_id", "concepts_tracked", "concepts_mastered", "avg_mastery", "avg_retention", "activity_count", "training_time_seconds", "training_hours"})
	for _, row := range rows {
		_ = cw.Write([]string{
			row.TenantID,
			row.CohortID,
			row.LearnerID,
			strconv.Itoa(row.ConceptsTracked),
			strconv.Itoa(row.ConceptsMastered),
			strconv.FormatFloat(row.AvgMastery, 'f', 4, 64),
			strconv.FormatFloat(row.AvgRetention, 'f', 4, 64),
			strconv.Itoa(row.ActivityCount),
			strconv.FormatInt(row.TrainingTimeSeconds, 10),
			strconv.FormatFloat(row.TrainingHours, 'f', 4, 64),
		})
	}
	cw.Flush()
}

func trainingTimeRows(value any) ([]core.TrainingTimeSummary, error) {
	rows, ok := value.([]core.TrainingTimeSummary)
	if !ok {
		return nil, fmt.Errorf("%w: analytics learner_time is unavailable", core.ErrInvalidInput)
	}
	return rows, nil
}

func (s *Server) alerts(w http.ResponseWriter, r *http.Request) {
	alerts, err := s.store.ListAlerts(r.Context(), r.PathValue("tenant_id"), time.Now().UTC())
	respond(w, alerts, err, http.StatusOK)
}

func (s *Server) patchAlert(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Status string `json:"status"`
	}
	if !decode(w, r, &req) {
		return
	}
	if req.Status == "" {
		req.Status = "ACKNOWLEDGED"
	}
	switch req.Status {
	case "OPEN", "ACKNOWLEDGED", "RESOLVED":
	default:
		problem(w, http.StatusBadRequest, "alert status must be OPEN, ACKNOWLEDGED, or RESOLVED")
		return
	}
	alert, err := s.store.UpdateAlertStatus(r.Context(), r.PathValue("tenant_id"), r.PathValue("alert_id"), req.Status, time.Now().UTC())
	respond(w, alert, err, http.StatusOK)
}

func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		problem(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return false
	}
	return true
}

func respond(w http.ResponseWriter, payload any, err error, status int) {
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, status, payload)
}

func handleError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, core.ErrNotFound):
		problem(w, http.StatusNotFound, err.Error())
	case errors.Is(err, core.ErrInvalidInput):
		problem(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, core.ErrTenantMismatch):
		problem(w, http.StatusForbidden, err.Error())
	case errors.Is(err, core.ErrConflict):
		problem(w, http.StatusConflict, err.Error())
	default:
		problem(w, http.StatusInternalServerError, err.Error())
	}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeRawJSON(w http.ResponseWriter, status int, payload []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(payload)
}

func writeIdempotencyReplay(w http.ResponseWriter, record core.IdempotencyRecord) {
	status := record.StatusCode
	if status <= 0 {
		status = http.StatusOK
	}
	w.Header().Set(idempotentReplayHeader, "true")
	writeRawJSON(w, status, record.Response)
}

func problem(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"error": message})
}

func parseDate(value string) (time.Time, error) {
	if value == "" {
		return time.Time{}, nil
	}
	parsed, err := time.Parse(time.DateOnly, value)
	if err != nil {
		return time.Time{}, err
	}
	return parsed, nil
}

func parseDateTime(value string) (time.Time, error) {
	if strings.TrimSpace(value) == "" {
		return time.Time{}, fmt.Errorf("datetime is required")
	}
	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(value))
	if err != nil {
		return time.Time{}, err
	}
	return parsed.UTC(), nil
}

// callerIsBootstrap reports whether the request carries the operator bootstrap
// secret. The comparison is constant time to avoid leaking the secret through
// timing, and a request never qualifies when no bootstrap secret is configured.
func (s *Server) callerIsBootstrap(r *http.Request) bool {
	if s.bootstrapToken == "" {
		return false
	}
	provided := r.Header.Get("X-LORE-Bootstrap-Token")
	if provided == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(s.bootstrapToken)) == 1
}

// callerClaims verifies and returns the bearer-token claims on the request, if
// any. It is used by the trust-anchor handlers (token issuance, membership
// management) which are not covered by the generic tenant-scoped middleware.
func (s *Server) callerClaims(r *http.Request) (auth.Claims, bool) {
	if s.tokens == nil {
		return auth.Claims{}, false
	}
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return auth.Claims{}, false
	}
	claims, err := s.tokens.Verify(strings.TrimPrefix(header, "Bearer "))
	if err != nil {
		return auth.Claims{}, false
	}
	return claims, true
}

// authorizeTokenIssue ensures only an authenticated caller may mint a JWT: the
// operator bootstrap secret, a super-admin, a tenant administrator of the
// target tenant, or a user refreshing their own token.
func (s *Server) authorizeTokenIssue(w http.ResponseWriter, r *http.Request, tenantID, userID string) bool {
	if s.callerIsBootstrap(r) {
		return true
	}
	claims, ok := s.callerClaims(r)
	if !ok {
		problem(w, http.StatusUnauthorized, "authentication is required to issue a token")
		return false
	}
	switch {
	case claims.Role == string(core.RoleSuperAdmin):
		return true
	case claims.Subject == userID && claims.TenantID == tenantID:
		return true
	case claims.Role == string(core.RoleTenantAdmin) && claims.TenantID == tenantID:
		return true
	default:
		problem(w, http.StatusForbidden, "insufficient privilege to issue a token for this user")
		return false
	}
}

func authAttemptKey(r *http.Request, tenantID, userID string) string {
	ip := clientIP(r)
	if tenantID == "" {
		tenantID = "unknown-tenant"
	}
	if userID == "" {
		userID = "unknown-user"
	}
	return ip + "|" + tenantID + "|" + userID
}

func clientIP(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		if first, _, ok := strings.Cut(forwarded, ","); ok {
			forwarded = first
		}
		if ip := strings.TrimSpace(forwarded); ip != "" {
			return ip
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	if r.RemoteAddr != "" {
		return r.RemoteAddr
	}
	return "unknown-ip"
}

func (s *Server) authAttemptLocked(key string, now time.Time) (time.Duration, bool) {
	s.authMu.Lock()
	defer s.authMu.Unlock()
	attempt, ok := s.authAttempts[key]
	if !ok {
		return 0, false
	}
	if attempt.LockedUntil.After(now) {
		return attempt.LockedUntil.Sub(now), true
	}
	if now.Sub(attempt.FirstFailure) > authFailureWindow {
		delete(s.authAttempts, key)
	}
	return 0, false
}

func (s *Server) recordAuthFailure(key string, now time.Time) {
	s.authMu.Lock()
	defer s.authMu.Unlock()
	attempt := s.authAttempts[key]
	if attempt.FirstFailure.IsZero() || now.Sub(attempt.FirstFailure) > authFailureWindow {
		attempt = authAttempt{FirstFailure: now}
	}
	attempt.Failures++
	if attempt.Failures >= maxAuthFailures {
		attempt.LockedUntil = now.Add(authLockout)
	}
	s.authAttempts[key] = attempt
}

func (s *Server) recordAuthSuccess(key string) {
	s.authMu.Lock()
	defer s.authMu.Unlock()
	delete(s.authAttempts, key)
}

// authorizeMembershipWrite gates membership creation when authentication is
// enabled: the bootstrap secret, a super-admin, or a tenant administrator of
// the path tenant. Only the bootstrap secret or a super-admin may grant the
// SUPER_ADMIN role. With JWT disabled the server runs in open local mode and
// authorization is skipped (role validity is still enforced by the caller).
func (s *Server) authorizeMembershipWrite(w http.ResponseWriter, r *http.Request, tenantID string, role core.Role) bool {
	if s.tokens == nil {
		return true
	}
	if s.callerIsBootstrap(r) {
		return true
	}
	claims, ok := s.callerClaims(r)
	if !ok {
		problem(w, http.StatusUnauthorized, "authentication is required to manage memberships")
		return false
	}
	isSuperAdmin := claims.Role == string(core.RoleSuperAdmin)
	isTenantAdmin := claims.Role == string(core.RoleTenantAdmin) && claims.TenantID == tenantID
	// B-27: le gestionnaire inscrit des apprenants, rien de plus — il ne peut
	// jamais accorder un rôle qui élève des privilèges.
	isManager := claims.Role == string(core.RoleManager) && claims.TenantID == tenantID
	if isManager && role == core.RoleLearner {
		return true
	}
	if !isSuperAdmin && !isTenantAdmin {
		problem(w, http.StatusForbidden, "only a super-admin or tenant administrator may manage memberships")
		return false
	}
	if role == core.RoleSuperAdmin && !isSuperAdmin {
		problem(w, http.StatusForbidden, "only a super-admin may grant the SUPER_ADMIN role")
		return false
	}
	return true
}

func (s *Server) authorizeTenantList(w http.ResponseWriter, r *http.Request) bool {
	if s.tokens == nil {
		return true
	}
	claims, ok := s.callerClaims(r)
	if !ok {
		problem(w, http.StatusUnauthorized, "super-admin bearer token is required to list tenants")
		return false
	}
	if claims.Role != string(core.RoleSuperAdmin) {
		problem(w, http.StatusForbidden, "only a super-admin may list tenants")
		return false
	}
	return true
}

func actorUserIDFromRequest(r *http.Request) string {
	claims, ok := r.Context().Value(claimsContextKey{}).(auth.Claims)
	if !ok {
		return ""
	}
	return claims.Subject
}

func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isPublicRoute(r) {
			next.ServeHTTP(w, r)
			return
		}
		if s.callerIsBootstrap(r) {
			next.ServeHTTP(w, r)
			return
		}
		tenantID, tenantScoped := tenantIDFromPath(r.URL.Path)
		if !tenantScoped {
			next.ServeHTTP(w, r)
			return
		}
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			problem(w, http.StatusUnauthorized, "bearer token is required")
			return
		}
		claims, err := s.tokens.Verify(strings.TrimPrefix(header, "Bearer "))
		if err != nil {
			problem(w, http.StatusUnauthorized, err.Error())
			return
		}
		if claims.Role != string(core.RoleSuperAdmin) && claims.TenantID != tenantID {
			problem(w, http.StatusForbidden, "token tenant does not match route tenant")
			return
		}
		if !isRoleAllowedForRoute(r, claims) {
			problem(w, http.StatusForbidden, "token role is not allowed for this route")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), claimsContextKey{}, claims)))
	})
}

func isRoleAllowedForRoute(r *http.Request, claims auth.Claims) bool {
	switch claims.Role {
	case string(core.RoleSuperAdmin), string(core.RoleTenantAdmin), string(core.RoleTrainer):
		return true
	case string(core.RoleManager):
		return isManagerAllowedRoute(r)
	case string(core.RoleLearner):
		return isLearnerAllowedRoute(r, claims.Subject)
	default:
		return false
	}
}

func isLearnerAllowedRoute(r *http.Request, learnerID string) bool {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		return false
	}
	tail := parts[3:]
	if len(tail) >= 2 && tail[0] == "learners" {
		if tail[1] != learnerID {
			return false
		}
		if r.Method == http.MethodGet && len(tail) == 3 && (tail[2] == "state" || tail[2] == "snapshots") {
			return true
		}
		if r.Method == http.MethodGet && len(tail) == 4 && tail[2] == "reviews" && tail[3] == "due" {
			return true
		}
		// B-24: a learner may read their own module path.
		if r.Method == http.MethodGet && len(tail) == 3 && tail[2] == "path" {
			return true
		}
		if r.Method == http.MethodPost && len(tail) == 4 && tail[2] == "activities" && tail[3] == "next" {
			return true
		}
		if r.Method == http.MethodPost && len(tail) == 4 && tail[2] == "assessments" && tail[3] == "plan" {
			return true
		}
		return false
	}
	// B-07: a learner drives the training-time clock of their own activity.
	// Ownership is enforced in the handlers (the activity's learner must match).
	if r.Method == http.MethodPost && len(tail) == 3 && tail[0] == "activities" &&
		(tail[2] == "start" || tail[2] == "pause" || tail[2] == "resume") {
		return true
	}
	if r.Method == http.MethodPost && len(tail) == 1 && tail[0] == "interactions" {
		return true
	}
	// B-25: the cohort schedule is readable by its learners (read-only).
	if r.Method == http.MethodGet && len(tail) == 1 &&
		(tail[0] == "training-sessions" || tail[0] == "training-sessions.ics") {
		return true
	}
	// B-24: a learner needs the syllabus list (read-only) to resolve its path.
	if r.Method == http.MethodGet && len(tail) == 1 && tail[0] == "syllabi" {
		return true
	}
	// B-18: learners read announcements (handler narrows to their cohorts).
	if r.Method == http.MethodGet && len(tail) == 1 && tail[0] == "announcements" {
		return true
	}
	// B-28: learners read the current legal texts, record their own consent
	// and see their consent history (handler forces identity from the token).
	if r.Method == http.MethodGet && len(tail) == 1 && tail[0] == "legal-texts" {
		return true
	}
	if len(tail) == 1 && tail[0] == "consents" && (r.Method == http.MethodGet || r.Method == http.MethodPost) {
		return true
	}
	// B-10: learners read documents in their scope (handler narrows the list).
	if r.Method == http.MethodGet && tail[0] == "documents" && len(tail) <= 2 {
		return true
	}
	// B-26: learners list assignments and hand in their own work.
	if r.Method == http.MethodGet && len(tail) == 1 && tail[0] == "assignments" {
		return true
	}
	if r.Method == http.MethodPost && len(tail) == 3 && tail[0] == "assignments" && tail[2] == "submissions" {
		return true
	}
	// B-11: learners read surveys, answer them (ownership enforced in handler)
	// and may open a complaint.
	if r.Method == http.MethodGet && tail[0] == "surveys" && len(tail) <= 2 {
		return true
	}
	if r.Method == http.MethodPost && len(tail) == 3 && tail[0] == "surveys" && tail[2] == "responses" {
		return true
	}
	if r.Method == http.MethodPost && len(tail) == 1 && tail[0] == "complaints" {
		return true
	}
	if r.Method == http.MethodPost && len(tail) == 3 && tail[0] == "assessments" && tail[2] == "submit" {
		return true
	}
	return false
}

func (s *Server) authorizeLearnerCommand(w http.ResponseWriter, r *http.Request, learnerID string) bool {
	claims, ok := r.Context().Value(claimsContextKey{}).(auth.Claims)
	if !ok || claims.Role != string(core.RoleLearner) {
		return true
	}
	if claims.Subject != learnerID {
		problem(w, http.StatusForbidden, "learner token cannot submit evidence for another learner")
		return false
	}
	return true
}

func isPublicRoute(r *http.Request) bool {
	if r.Method == http.MethodGet && (r.URL.Path == "/health" || r.URL.Path == "/metrics") {
		return true
	}
	// /v1/auth/token performs its own caller authorization (bootstrap secret or
	// an authorized JWT) inside the handler, so it is exempt from the generic
	// tenant-scoped bearer check but is NOT unauthenticated.
	if r.Method == http.MethodPost && (r.URL.Path == "/v1/tenants" || r.URL.Path == "/v1/users" || r.URL.Path == "/v1/auth/token") {
		return true
	}
	// B-23: invite lookup is public by design (the unguessable code is the
	// credential); redemption enforces the bootstrap secret in its handler.
	if strings.HasPrefix(r.URL.Path, "/v1/invites/") {
		if r.Method == http.MethodGet {
			return true
		}
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/redeem") {
			return true
		}
	}
	return false
}

func tenantIDFromPath(path string) (string, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 3 || parts[0] != "v1" || parts[1] != "tenants" {
		return "", false
	}
	return parts[2], parts[2] != ""
}

func (s *Server) invalidateLearnerState(ctx context.Context, tenantID, learnerID string) {
	if s.cache != nil {
		_ = s.cache.Delete(ctx, learnerStateCacheKey(tenantID, learnerID))
	}
}

func learnerStateCacheKey(tenantID, learnerID string) string {
	return "lore:learner_state:" + tenantID + ":" + learnerID
}
