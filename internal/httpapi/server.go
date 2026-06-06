package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"lore/internal/auth"
	"lore/internal/cache"
	"lore/internal/core"
	"lore/internal/llm"
	"lore/internal/runtime"
)

type Repository interface {
	runtime.Store
	CreateTenant(ctx context.Context, name, slug, parentID string) (core.Tenant, error)
	GetTenant(ctx context.Context, tenantID string) (core.Tenant, error)
	CreateUser(ctx context.Context, email, name string) (core.User, error)
	AddMembership(ctx context.Context, tenantID, userID string, role core.Role) (core.Membership, error)
	ListMemberships(ctx context.Context, tenantID string) ([]core.Membership, error)
	CreateProgram(ctx context.Context, tenantID, name string) (core.Program, error)
	CreateCohort(ctx context.Context, tenantID, programID, name string, start, end time.Time) (core.Cohort, error)
	EnrollLearner(ctx context.Context, tenantID, cohortID, learnerID string) (core.CohortEnrollment, error)
	CreateSyllabus(ctx context.Context, tenantID, title, description string, objectives, outcomes map[string]any) (core.Syllabus, error)
	BindSyllabus(ctx context.Context, tenantID, syllabusID, targetType, targetID, adaptationMode string) (core.SyllabusBinding, error)
	CreateDomain(ctx context.Context, tenantID, ownerID, name, description, source string, drafts []core.ConceptDraft, depDrafts []core.DependencyDraft) (core.DomainGraph, error)
	ReplaceDomainGraph(ctx context.Context, tenantID, domainID string, drafts []core.ConceptDraft, depDrafts []core.DependencyDraft) (core.DomainGraph, error)
	StartActivity(ctx context.Context, tenantID, activityID string) (core.Activity, error)
	ListDueReviews(ctx context.Context, tenantID, learnerID string, now time.Time) ([]core.ReviewCard, error)
	GetInstruction(ctx context.Context, tenantID, instructionID string) (core.TutorInstruction, error)
	SaveGeneratedContent(ctx context.Context, content core.GeneratedContent) error
	ListGeneratedContent(ctx context.Context, tenantID, instructionID string) ([]core.GeneratedContent, error)
	GetGeneratedContent(ctx context.Context, tenantID, contentID string) (core.GeneratedContent, error)
	GetLLMConfiguration(ctx context.Context, tenantID string) (core.LLMConfiguration, error)
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

	configMu    sync.RWMutex
	llmProvider string
	llmModel    string
	tokens      *auth.TokenService
	cache       cache.Cache
}

func NewServer(store Repository, engine *runtime.Engine, generator llm.Generator, provider, model string) *Server {
	return &Server{store: store, engine: engine, generator: generator, llmProvider: provider, llmModel: model}
}

func (s *Server) EnableJWT(secret string) {
	if secret != "" {
		s.tokens = auth.NewTokenService(secret)
	}
}

func (s *Server) EnableCache(c cache.Cache) {
	if c != nil {
		s.cache = c
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)

	mux.HandleFunc("POST /v1/auth/token", s.issueToken)
	mux.HandleFunc("POST /v1/tenants", s.createTenant)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}", s.getTenant)
	mux.HandleFunc("POST /v1/users", s.createUser)

	mux.HandleFunc("POST /v1/tenants/{tenant_id}/memberships", s.addMembership)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/memberships", s.listMemberships)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/programs", s.createProgram)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/cohorts", s.createCohort)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/cohorts/{cohort_id}/enrollments", s.enrollLearner)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/syllabi", s.createSyllabus)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/syllabi/{syllabus_id}/bindings", s.bindSyllabus)

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
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/alerts", s.alerts)
	mux.HandleFunc("PATCH /v1/tenants/{tenant_id}/alerts/{alert_id}", s.patchAlert)
	if s.tokens == nil {
		return mux
	}
	return s.authMiddleware(mux)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
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
	var req struct {
		TenantID   string `json:"tenant_id"`
		UserID     string `json:"user_id"`
		TTLSeconds int64  `json:"ttl_seconds"`
	}
	if !decode(w, r, &req) {
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
	token, err := s.tokens.Issue(req.UserID, req.TenantID, string(role), ttl)
	if err != nil {
		respond(w, nil, err, http.StatusOK)
		return
	}
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
	membership, err := s.store.AddMembership(r.Context(), r.PathValue("tenant_id"), req.UserID, req.Role)
	respond(w, membership, err, http.StatusCreated)
}

func (s *Server) listMemberships(w http.ResponseWriter, r *http.Request) {
	memberships, err := s.store.ListMemberships(r.Context(), r.PathValue("tenant_id"))
	respond(w, memberships, err, http.StatusOK)
}

func (s *Server) createProgram(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &req) {
		return
	}
	program, err := s.store.CreateProgram(r.Context(), r.PathValue("tenant_id"), req.Name)
	respond(w, program, err, http.StatusCreated)
}

func (s *Server) createCohort(w http.ResponseWriter, r *http.Request) {
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
	cohort, err := s.store.CreateCohort(r.Context(), r.PathValue("tenant_id"), req.ProgramID, req.Name, start, end)
	respond(w, cohort, err, http.StatusCreated)
}

func (s *Server) enrollLearner(w http.ResponseWriter, r *http.Request) {
	var req struct {
		LearnerID string `json:"learner_id"`
	}
	if !decode(w, r, &req) {
		return
	}
	enrollment, err := s.store.EnrollLearner(r.Context(), r.PathValue("tenant_id"), r.PathValue("cohort_id"), req.LearnerID)
	respond(w, enrollment, err, http.StatusCreated)
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
	var req core.InteractionCommand
	if !decode(w, r, &req) {
		return
	}
	req.TenantID = r.PathValue("tenant_id")
	req.ActivityID = r.PathValue("activity_id")
	if !s.authorizeLearnerCommand(w, r, req.LearnerID) {
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
	config, err := s.store.GetLLMConfiguration(r.Context(), tenantID)
	if errors.Is(err, core.ErrNotFound) {
		config = s.defaultLLMConfig(tenantID)
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
	defaults := s.defaultLLMConfig(tenantID)
	config := core.LLMConfiguration{
		TenantID:    tenantID,
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
	content, err := s.generatorForTenant(r.Context(), tenantID).Generate(r.Context(), instruction)
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
	return core.LLMConfiguration{TenantID: tenantID, Provider: s.llmProvider, Model: s.llmModel}
}

func (s *Server) generatorForTenant(ctx context.Context, tenantID string) llm.Generator {
	config, err := s.store.GetLLMConfiguration(ctx, tenantID)
	if err != nil {
		return s.generator
	}
	defaults := s.defaultLLMConfig(tenantID)
	if config.Provider == "" {
		config.Provider = defaults.Provider
	}
	if config.Model == "" {
		config.Model = defaults.Model
	}
	return llm.NewGeneratorFromConfig(llm.ProviderConfig{
		Provider:      config.Provider,
		Model:         config.Model,
		OllamaBaseURL: config.BaseURL,
		BaseURL:       config.BaseURL,
		APIKey:        config.APIKey,
	})
}

func publicLLMConfig(config core.LLMConfiguration) core.LLMConfiguration {
	if config.APIKey != "" {
		config.APIKeyConfigured = true
	}
	config.APIKey = ""
	return config
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

func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isPublicRoute(r) {
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
	if r.Method == http.MethodGet && r.URL.Path == "/health" {
		return true
	}
	if r.Method == http.MethodPost && (r.URL.Path == "/v1/tenants" || r.URL.Path == "/v1/users" || r.URL.Path == "/v1/auth/token") {
		return true
	}
	if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/memberships") {
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
