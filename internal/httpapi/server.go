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
	CreateDomain(ctx context.Context, tenantID, ownerID, name, description, source string, drafts []core.ConceptDraft, depDrafts []core.DependencyDraft) (core.DomainGraph, error)
	ListDomains(ctx context.Context, tenantID string) ([]core.Domain, error)
	ReplaceDomainGraph(ctx context.Context, tenantID, domainID string, drafts []core.ConceptDraft, depDrafts []core.DependencyDraft) (core.DomainGraph, error)
	StartActivity(ctx context.Context, tenantID, activityID string) (core.Activity, error)
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
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/admin-audit-logs", s.listAdminAuditLogs)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/syllabi", s.listSyllabi)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/syllabi", s.createSyllabus)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/syllabi/{syllabus_id}/bindings", s.bindSyllabus)

	mux.HandleFunc("GET /v1/tenants/{tenant_id}/domains", s.listDomains)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/domains", s.createDomain)
	mux.HandleFunc("PUT /v1/tenants/{tenant_id}/domains/{domain_id}/graph", s.replaceDomainGraph)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/domains/{domain_id}", s.getDomain)

	mux.HandleFunc("POST /v1/tenants/{tenant_id}/learners/{learner_id}/activities/next", s.nextActivity)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/activities/{activity_id}/start", s.startActivity)
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
		problem(w, http.StatusBadRequest, "role must be one of SUPER_ADMIN, TENANT_ADMIN, TRAINER, LEARNER")
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
	if !s.authorizeAdminMutation(w, r, tenantID) {
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
	if !s.authorizeAdminMutation(w, r, tenantID) {
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
	if !s.authorizeAdminMutation(w, r, tenantID) {
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
	if !s.authorizeAdminMutation(w, r, tenantID) {
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
	if !s.authorizeAdminMutation(w, r, tenantID) {
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
	if !s.authorizeAdminMutation(w, r, tenantID) {
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
	if !s.authorizeAdminMutation(w, r, tenantID) {
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
	if !s.authorizeAdminMutation(w, r, tenantID) {
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
	if !s.authorizeAdminMutation(w, r, tenantID) {
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
	if !s.authorizeAdminMutation(w, r, tenantID) {
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
	if !s.authorizeAdminMutation(w, r, tenantID) {
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
	if !s.authorizeAdminMutation(w, r, tenantID) {
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
	if !s.authorizeAdminMutation(w, r, tenantID) {
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
	if !s.authorizeAdminMutation(w, r, tenantID) {
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
		DomainID string `json:"domain_id"`
		Intent   string `json:"intent"`
	}
	if !decode(w, r, &req) {
		return
	}
	decision, err := s.engine.PlanNext(r.Context(), runtime.PlanNextInput{
		TenantID:  r.PathValue("tenant_id"),
		LearnerID: r.PathValue("learner_id"),
		DomainID:  req.DomainID,
		Intent:    req.Intent,
	})
	respond(w, decision, err, http.StatusCreated)
}

func (s *Server) startActivity(w http.ResponseWriter, r *http.Request) {
	activity, err := s.store.StartActivity(r.Context(), r.PathValue("tenant_id"), r.PathValue("activity_id"))
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

func (s *Server) authorizeAdminMutation(w http.ResponseWriter, r *http.Request, tenantID string) bool {
	if s.tokens == nil {
		return true
	}
	if s.callerIsBootstrap(r) {
		return true
	}
	claims, ok := r.Context().Value(claimsContextKey{}).(auth.Claims)
	if !ok {
		var found bool
		claims, found = s.callerClaims(r)
		ok = found
	}
	if !ok {
		problem(w, http.StatusUnauthorized, "authentication is required for admin mutation")
		return false
	}
	if claims.Role == string(core.RoleSuperAdmin) {
		return true
	}
	if claims.Role == string(core.RoleTenantAdmin) && claims.TenantID == tenantID {
		return true
	}
	problem(w, http.StatusForbidden, "only a tenant administrator or super-admin may perform this admin mutation")
	return false
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
		if r.Method == http.MethodPost && len(tail) == 4 && tail[2] == "activities" && tail[3] == "next" {
			return true
		}
		if r.Method == http.MethodPost && len(tail) == 4 && tail[2] == "assessments" && tail[3] == "plan" {
			return true
		}
		return false
	}
	if r.Method == http.MethodPost && len(tail) == 1 && tail[0] == "interactions" {
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
