package store

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"lore/internal/core"
	"lore/internal/ids"
	"lore/internal/runtime"
)

type MemoryStore struct {
	mu sync.RWMutex

	tenants     map[string]core.Tenant
	users       map[string]core.User
	memberships map[string]core.Membership

	programs    map[string]core.Program
	cohorts     map[string]core.Cohort
	enrollments map[string]core.CohortEnrollment
	syllabi     map[string]core.Syllabus
	bindings    map[string]core.SyllabusBinding

	domains      map[string]core.Domain
	concepts     map[string]core.Concept
	dependencies map[string]core.Dependency

	states       map[string]core.LearnerState
	activities   map[string]core.Activity
	instructions map[string]core.TutorInstruction
	contents     map[string]core.GeneratedContent
	llmConfigs   map[string]core.LLMConfiguration
	interactions map[string]core.Interaction
	evaluations  map[string]core.Evaluation
	snapshots    map[string]core.PedagogicalSnapshot
	alerts       map[string]core.Alert
	alertDedupe  map[string]string
	events       map[string]core.Event
	idempotency  map[string]core.IdempotencyRecord
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		tenants:      map[string]core.Tenant{},
		users:        map[string]core.User{},
		memberships:  map[string]core.Membership{},
		programs:     map[string]core.Program{},
		cohorts:      map[string]core.Cohort{},
		enrollments:  map[string]core.CohortEnrollment{},
		syllabi:      map[string]core.Syllabus{},
		bindings:     map[string]core.SyllabusBinding{},
		domains:      map[string]core.Domain{},
		concepts:     map[string]core.Concept{},
		dependencies: map[string]core.Dependency{},
		states:       map[string]core.LearnerState{},
		activities:   map[string]core.Activity{},
		instructions: map[string]core.TutorInstruction{},
		contents:     map[string]core.GeneratedContent{},
		llmConfigs:   map[string]core.LLMConfiguration{},
		interactions: map[string]core.Interaction{},
		evaluations:  map[string]core.Evaluation{},
		snapshots:    map[string]core.PedagogicalSnapshot{},
		alerts:       map[string]core.Alert{},
		alertDedupe:  map[string]string{},
		events:       map[string]core.Event{},
		idempotency:  map[string]core.IdempotencyRecord{},
	}
}

func (s *MemoryStore) CreateTenant(_ context.Context, name, slug, parentID string) (core.Tenant, error) {
	if strings.TrimSpace(name) == "" || strings.TrimSpace(slug) == "" {
		return core.Tenant{}, fmt.Errorf("%w: tenant name and slug are required", core.ErrInvalidInput)
	}
	now := time.Now().UTC()
	tenant := core.Tenant{
		ID:        ids.New(),
		ParentID:  parentID,
		Name:      strings.TrimSpace(name),
		Slug:      strings.TrimSpace(slug),
		Status:    "ACTIVE",
		CreatedAt: now,
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.tenants {
		if existing.Slug == tenant.Slug {
			return core.Tenant{}, fmt.Errorf("%w: tenant slug already exists", core.ErrConflict)
		}
	}
	if parentID != "" {
		if _, ok := s.tenants[parentID]; !ok {
			return core.Tenant{}, fmt.Errorf("%w: parent tenant", core.ErrNotFound)
		}
	}
	s.tenants[tenant.ID] = tenant
	event := memoryEvent(tenant.ID, "TenantCreated", "tenant", tenant.ID, now, nil)
	s.events[key(tenant.ID, event.ID)] = event
	return tenant, nil
}

func (s *MemoryStore) GetTenant(_ context.Context, tenantID string) (core.Tenant, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	tenant, ok := s.tenants[tenantID]
	if !ok {
		return core.Tenant{}, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	return tenant, nil
}

func (s *MemoryStore) CreateUser(_ context.Context, email, name string) (core.User, error) {
	if strings.TrimSpace(email) == "" {
		return core.User{}, fmt.Errorf("%w: email is required", core.ErrInvalidInput)
	}
	now := time.Now().UTC()
	user := core.User{ID: ids.New(), Email: strings.TrimSpace(email), Name: strings.TrimSpace(name), Status: "ACTIVE", CreatedAt: now}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.users {
		if strings.EqualFold(existing.Email, user.Email) {
			return core.User{}, fmt.Errorf("%w: user email already exists", core.ErrConflict)
		}
	}
	s.users[user.ID] = user
	return user, nil
}

func (s *MemoryStore) AddMembership(_ context.Context, tenantID, userID string, role core.Role) (core.Membership, error) {
	if role == "" {
		role = core.RoleLearner
	}
	if !role.Valid() {
		return core.Membership{}, fmt.Errorf("%w: unknown role %q", core.ErrInvalidInput, role)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return core.Membership{}, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	if _, ok := s.users[userID]; !ok {
		return core.Membership{}, fmt.Errorf("%w: user", core.ErrNotFound)
	}
	membership := core.Membership{TenantID: tenantID, UserID: userID, Role: role, Status: "ACTIVE", CreatedAt: time.Now().UTC()}
	s.memberships[key(tenantID, userID)] = membership
	event := memoryEvent(tenantID, "MembershipChanged", "membership", userID, membership.CreatedAt, map[string]any{"user_id": userID, "role": role})
	s.events[key(tenantID, event.ID)] = event
	return membership, nil
}

func (s *MemoryStore) ListMemberships(_ context.Context, tenantID string) ([]core.Membership, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return nil, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	var result []core.Membership
	for _, membership := range s.memberships {
		if membership.TenantID == tenantID {
			result = append(result, membership)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].UserID < result[j].UserID })
	return result, nil
}

func (s *MemoryStore) CreateProgram(_ context.Context, tenantID, name string) (core.Program, error) {
	if strings.TrimSpace(name) == "" {
		return core.Program{}, fmt.Errorf("%w: program name is required", core.ErrInvalidInput)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return core.Program{}, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	program := core.Program{TenantID: tenantID, ID: ids.New(), Name: strings.TrimSpace(name), CreatedAt: time.Now().UTC()}
	s.programs[key(tenantID, program.ID)] = program
	event := memoryEvent(tenantID, "ProgramCreated", "program", program.ID, program.CreatedAt, map[string]any{"name": program.Name})
	s.events[key(tenantID, event.ID)] = event
	return program, nil
}

func (s *MemoryStore) CreateCohort(_ context.Context, tenantID, programID, name string, start, end time.Time) (core.Cohort, error) {
	if strings.TrimSpace(name) == "" {
		return core.Cohort{}, fmt.Errorf("%w: cohort name is required", core.ErrInvalidInput)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return core.Cohort{}, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	if programID != "" {
		if _, ok := s.programs[key(tenantID, programID)]; !ok {
			return core.Cohort{}, fmt.Errorf("%w: program", core.ErrNotFound)
		}
	}
	cohort := core.Cohort{TenantID: tenantID, ID: ids.New(), ProgramID: programID, Name: strings.TrimSpace(name), StartDate: start, EndDate: end, CreatedAt: time.Now().UTC()}
	s.cohorts[key(tenantID, cohort.ID)] = cohort
	event := memoryEvent(tenantID, "CohortCreated", "cohort", cohort.ID, cohort.CreatedAt, map[string]any{"program_id": programID, "name": cohort.Name})
	s.events[key(tenantID, event.ID)] = event
	return cohort, nil
}

func (s *MemoryStore) EnrollLearner(_ context.Context, tenantID, cohortID, learnerID string) (core.CohortEnrollment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.cohorts[key(tenantID, cohortID)]; !ok {
		return core.CohortEnrollment{}, fmt.Errorf("%w: cohort", core.ErrNotFound)
	}
	enrollment := core.CohortEnrollment{TenantID: tenantID, CohortID: cohortID, LearnerID: learnerID, Status: "ACTIVE", CreatedAt: time.Now().UTC()}
	s.enrollments[key(tenantID, cohortID, learnerID)] = enrollment
	event := memoryEvent(tenantID, "LearnerEnrolled", "cohort_enrollment", cohortID, enrollment.CreatedAt, map[string]any{"cohort_id": cohortID, "learner_id": learnerID})
	s.events[key(tenantID, event.ID)] = event
	return enrollment, nil
}

func (s *MemoryStore) CreateSyllabus(_ context.Context, tenantID, title, description string, objectives, outcomes map[string]any) (core.Syllabus, error) {
	if strings.TrimSpace(title) == "" {
		return core.Syllabus{}, fmt.Errorf("%w: syllabus title is required", core.ErrInvalidInput)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return core.Syllabus{}, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	syllabus := core.Syllabus{TenantID: tenantID, ID: ids.New(), Title: strings.TrimSpace(title), Description: description, Objectives: objectives, Outcomes: outcomes, CreatedAt: time.Now().UTC()}
	s.syllabi[key(tenantID, syllabus.ID)] = syllabus
	event := memoryEvent(tenantID, "SyllabusCreated", "syllabus", syllabus.ID, syllabus.CreatedAt, map[string]any{"title": syllabus.Title})
	s.events[key(tenantID, event.ID)] = event
	return syllabus, nil
}

func (s *MemoryStore) BindSyllabus(_ context.Context, tenantID, syllabusID, targetType, targetID, adaptationMode string) (core.SyllabusBinding, error) {
	if adaptationMode == "" {
		adaptationMode = "GUIDED"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.syllabi[key(tenantID, syllabusID)]; !ok {
		return core.SyllabusBinding{}, fmt.Errorf("%w: syllabus", core.ErrNotFound)
	}
	binding := core.SyllabusBinding{TenantID: tenantID, ID: ids.New(), SyllabusID: syllabusID, TargetType: targetType, TargetID: targetID, AdaptationMode: adaptationMode, CreatedAt: time.Now().UTC()}
	s.bindings[key(tenantID, binding.ID)] = binding
	event := memoryEvent(tenantID, "SyllabusBound", "syllabus_binding", binding.ID, binding.CreatedAt, map[string]any{"syllabus_id": syllabusID, "target_type": targetType, "target_id": targetID})
	s.events[key(tenantID, event.ID)] = event
	return binding, nil
}

func (s *MemoryStore) CreateDomain(_ context.Context, tenantID, ownerID, name, description, source string, drafts []core.ConceptDraft, depDrafts []core.DependencyDraft) (core.DomainGraph, error) {
	if strings.TrimSpace(name) == "" {
		return core.DomainGraph{}, fmt.Errorf("%w: domain name is required", core.ErrInvalidInput)
	}
	if source == "" {
		source = "TRAINER"
	}
	now := time.Now().UTC()
	domain := core.Domain{
		TenantID:     tenantID,
		ID:           ids.New(),
		OwnerID:      ownerID,
		Name:         strings.TrimSpace(name),
		Description:  description,
		Source:       source,
		GraphVersion: 1,
		Status:       "ACTIVE",
		Phase:        core.PhaseInstruction,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	graph, err := buildGraph(domain, drafts, depDrafts)
	if err != nil {
		return core.DomainGraph{}, err
	}
	if err := runtime.ValidateGraph(graph.Concepts, graph.Dependencies); err != nil {
		return core.DomainGraph{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return core.DomainGraph{}, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	s.domains[key(tenantID, domain.ID)] = domain
	for _, concept := range graph.Concepts {
		s.concepts[key(tenantID, domain.ID, concept.ID)] = concept
	}
	for _, dep := range graph.Dependencies {
		s.dependencies[key(tenantID, domain.ID, dep.ParentConceptID, dep.ChildConceptID)] = dep
	}
	event := memoryEvent(tenantID, "DomainCreated", "domain", domain.ID, domain.CreatedAt, map[string]any{"name": domain.Name})
	s.events[key(tenantID, event.ID)] = event
	return graph, nil
}

func (s *MemoryStore) ReplaceDomainGraph(_ context.Context, tenantID, domainID string, drafts []core.ConceptDraft, depDrafts []core.DependencyDraft) (core.DomainGraph, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	domain, ok := s.domains[key(tenantID, domainID)]
	if !ok {
		return core.DomainGraph{}, fmt.Errorf("%w: domain", core.ErrNotFound)
	}
	domain.GraphVersion++
	domain.UpdatedAt = time.Now().UTC()
	graph, err := buildGraph(domain, drafts, depDrafts)
	if err != nil {
		return core.DomainGraph{}, err
	}
	if err := runtime.ValidateGraph(graph.Concepts, graph.Dependencies); err != nil {
		return core.DomainGraph{}, err
	}
	for conceptKey, concept := range s.concepts {
		if concept.TenantID == tenantID && concept.DomainID == domainID {
			delete(s.concepts, conceptKey)
		}
	}
	for depKey, dep := range s.dependencies {
		if dep.TenantID == tenantID && dep.DomainID == domainID {
			delete(s.dependencies, depKey)
		}
	}
	s.domains[key(tenantID, domainID)] = domain
	for _, concept := range graph.Concepts {
		s.concepts[key(tenantID, domainID, concept.ID)] = concept
	}
	for _, dep := range graph.Dependencies {
		s.dependencies[key(tenantID, domainID, dep.ParentConceptID, dep.ChildConceptID)] = dep
	}
	event := memoryEvent(tenantID, "ConceptGraphPublished", "domain", domainID, domain.UpdatedAt, map[string]any{"graph_version": domain.GraphVersion})
	s.events[key(tenantID, event.ID)] = event
	return graph, nil
}

func (s *MemoryStore) GetDomainGraph(_ context.Context, tenantID, domainID string) (core.DomainGraph, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	domain, ok := s.domains[key(tenantID, domainID)]
	if !ok {
		return core.DomainGraph{}, fmt.Errorf("%w: domain", core.ErrNotFound)
	}
	var concepts []core.Concept
	for _, concept := range s.concepts {
		if concept.TenantID == tenantID && concept.DomainID == domainID {
			concepts = append(concepts, concept)
		}
	}
	var deps []core.Dependency
	for _, dep := range s.dependencies {
		if dep.TenantID == tenantID && dep.DomainID == domainID {
			deps = append(deps, dep)
		}
	}
	sort.Slice(concepts, func(i, j int) bool {
		if concepts[i].Name == concepts[j].Name {
			return concepts[i].ID < concepts[j].ID
		}
		return concepts[i].Name < concepts[j].Name
	})
	sort.Slice(deps, func(i, j int) bool {
		if deps[i].ParentConceptID == deps[j].ParentConceptID {
			return deps[i].ChildConceptID < deps[j].ChildConceptID
		}
		return deps[i].ParentConceptID < deps[j].ParentConceptID
	})
	return core.DomainGraph{Domain: domain, Concepts: concepts, Dependencies: deps}, nil
}

func (s *MemoryStore) GetLearnerStates(_ context.Context, tenantID, learnerID, domainID string) ([]core.LearnerState, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []core.LearnerState
	for _, state := range s.states {
		if state.TenantID == tenantID && state.LearnerID == learnerID && state.DomainID == domainID {
			result = append(result, state)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ConceptID < result[j].ConceptID })
	return result, nil
}

func (s *MemoryStore) ListLearnerState(_ context.Context, tenantID, learnerID string) ([]core.LearnerState, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []core.LearnerState
	for _, state := range s.states {
		if state.TenantID == tenantID && state.LearnerID == learnerID {
			result = append(result, state)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].DomainID == result[j].DomainID {
			return result[i].ConceptID < result[j].ConceptID
		}
		return result[i].DomainID < result[j].DomainID
	})
	return result, nil
}

func (s *MemoryStore) ListDueReviews(_ context.Context, tenantID, learnerID string, now time.Time) ([]core.ReviewCard, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []core.ReviewCard
	for _, state := range s.states {
		if state.TenantID != tenantID || state.LearnerID != learnerID {
			continue
		}
		if state.DueAt == nil || state.DueAt.After(now) || state.CardState == core.ReviewNew {
			continue
		}
		result = append(result, core.ReviewCard{
			TenantID:   state.TenantID,
			LearnerID:  state.LearnerID,
			DomainID:   state.DomainID,
			ConceptID:  state.ConceptID,
			DueAt:      *state.DueAt,
			Stability:  state.Stability,
			Difficulty: state.Difficulty,
			Reps:       state.Reps,
			Lapses:     state.Lapses,
			State:      state.CardState,
			Retention:  runtime.Retention(state.Stability, state.DueAt, now),
		})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].DueAt.Equal(result[j].DueAt) {
			return result[i].ConceptID < result[j].ConceptID
		}
		return result[i].DueAt.Before(result[j].DueAt)
	})
	return result, nil
}

func (s *MemoryStore) GetRecentInteractions(_ context.Context, tenantID, learnerID, domainID string, limit int) ([]core.Interaction, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []core.Interaction
	for _, interaction := range s.interactions {
		if interaction.TenantID == tenantID && interaction.LearnerID == learnerID && interaction.DomainID == domainID {
			result = append(result, interaction)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.After(result[j].CreatedAt) })
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	return result, nil
}

func (s *MemoryStore) SavePlannedActivity(_ context.Context, activity core.Activity, instruction core.TutorInstruction, snapshot core.PedagogicalSnapshot, events []core.Event) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tenants[activity.TenantID]; !ok {
		return fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	if activity.TenantID != instruction.TenantID || activity.TenantID != snapshot.TenantID {
		return fmt.Errorf("%w: planned activity bundle", core.ErrTenantMismatch)
	}
	s.activities[key(activity.TenantID, activity.ID)] = activity
	s.instructions[key(instruction.TenantID, instruction.ID)] = instruction
	s.snapshots[key(snapshot.TenantID, snapshot.ID)] = snapshot
	for _, event := range events {
		if event.TenantID != activity.TenantID {
			return fmt.Errorf("%w: event", core.ErrTenantMismatch)
		}
		s.events[key(event.TenantID, event.ID)] = event
	}
	return nil
}

func (s *MemoryStore) ListEvents(_ context.Context, tenantID string, unpublishedOnly bool) ([]core.Event, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []core.Event
	for _, event := range s.events {
		if event.TenantID != tenantID {
			continue
		}
		if unpublishedOnly && event.PublishedAt != nil {
			continue
		}
		result = append(result, event)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].OccurredAt.Equal(result[j].OccurredAt) {
			return result[i].ID < result[j].ID
		}
		return result[i].OccurredAt.Before(result[j].OccurredAt)
	})
	return result, nil
}

func (s *MemoryStore) ListUnpublishedEvents(_ context.Context, limit int) ([]core.Event, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []core.Event
	for _, event := range s.events {
		if event.PublishedAt != nil {
			continue
		}
		result = append(result, event)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].OccurredAt.Equal(result[j].OccurredAt) {
			return result[i].ID < result[j].ID
		}
		return result[i].OccurredAt.Before(result[j].OccurredAt)
	})
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	return result, nil
}

func (s *MemoryStore) MarkEventPublished(_ context.Context, tenantID, eventID string, now time.Time) (core.Event, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	event, ok := s.events[key(tenantID, eventID)]
	if !ok {
		return core.Event{}, fmt.Errorf("%w: event", core.ErrNotFound)
	}
	event.PublishedAt = &now
	s.events[key(tenantID, eventID)] = event
	return event, nil
}

func (s *MemoryStore) GetActivity(_ context.Context, tenantID, activityID string) (core.Activity, core.TutorInstruction, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	activity, ok := s.activities[key(tenantID, activityID)]
	if !ok {
		return core.Activity{}, core.TutorInstruction{}, fmt.Errorf("%w: activity", core.ErrNotFound)
	}
	instruction, ok := s.instructions[key(tenantID, activity.InstructionID)]
	if !ok {
		return core.Activity{}, core.TutorInstruction{}, fmt.Errorf("%w: tutor instruction", core.ErrNotFound)
	}
	return activity, instruction, nil
}

func (s *MemoryStore) StartActivity(_ context.Context, tenantID, activityID string) (core.Activity, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	activity, ok := s.activities[key(tenantID, activityID)]
	if !ok {
		return core.Activity{}, fmt.Errorf("%w: activity", core.ErrNotFound)
	}
	now := time.Now().UTC()
	activity.Status = core.ActivityStarted
	activity.StartedAt = &now
	s.activities[key(tenantID, activityID)] = activity
	event := memoryEvent(tenantID, "ActivityStarted", "activity", activityID, now, map[string]any{"learner_id": activity.LearnerID})
	s.events[key(tenantID, event.ID)] = event
	return activity, nil
}

func (s *MemoryStore) SaveInteractionDelta(_ context.Context, delta core.StateDelta, activity core.Activity) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveInteractionDeltaLocked(delta, activity)
}

func (s *MemoryStore) SaveInteractionDeltaIdempotent(_ context.Context, delta core.StateDelta, activity core.Activity, record core.IdempotencyRecord) error {
	if record.TenantID == "" || record.Key == "" || record.StatusCode <= 0 || len(record.Response) == 0 {
		return fmt.Errorf("%w: invalid idempotency record", core.ErrInvalidInput)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.idempotency[key(record.TenantID, record.Key)]; ok {
		return fmt.Errorf("%w: idempotency record", core.ErrConflict)
	}
	if err := s.saveInteractionDeltaLocked(delta, activity); err != nil {
		return err
	}
	if record.CreatedAt.IsZero() {
		record.CreatedAt = time.Now().UTC()
	}
	record.Response = append([]byte(nil), record.Response...)
	s.idempotency[key(record.TenantID, record.Key)] = record
	return nil
}

func (s *MemoryStore) saveInteractionDeltaLocked(delta core.StateDelta, activity core.Activity) error {
	if delta.Interaction.TenantID != activity.TenantID || delta.After.TenantID != activity.TenantID || delta.Snapshot.TenantID != activity.TenantID {
		return fmt.Errorf("%w: interaction delta", core.ErrTenantMismatch)
	}
	if _, ok := s.activities[key(activity.TenantID, activity.ID)]; !ok {
		return fmt.Errorf("%w: activity", core.ErrNotFound)
	}
	s.activities[key(activity.TenantID, activity.ID)] = activity
	s.interactions[key(delta.Interaction.TenantID, delta.Interaction.ID)] = delta.Interaction
	s.evaluations[key(delta.Evaluation.TenantID, delta.Evaluation.ID)] = delta.Evaluation
	s.states[key(delta.After.TenantID, delta.After.LearnerID, delta.After.ConceptID)] = delta.After
	s.snapshots[key(delta.Snapshot.TenantID, delta.Snapshot.ID)] = delta.Snapshot
	for _, event := range delta.Events {
		if event.TenantID != activity.TenantID {
			return fmt.Errorf("%w: event", core.ErrTenantMismatch)
		}
		s.events[key(event.TenantID, event.ID)] = event
	}
	return nil
}

func (s *MemoryStore) GetInstruction(_ context.Context, tenantID, instructionID string) (core.TutorInstruction, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	instruction, ok := s.instructions[key(tenantID, instructionID)]
	if !ok {
		return core.TutorInstruction{}, fmt.Errorf("%w: tutor instruction", core.ErrNotFound)
	}
	return instruction, nil
}

func (s *MemoryStore) SaveGeneratedContent(_ context.Context, content core.GeneratedContent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.instructions[key(content.TenantID, content.InstructionID)]; !ok {
		return fmt.Errorf("%w: tutor instruction", core.ErrNotFound)
	}
	s.contents[key(content.TenantID, content.ID)] = content
	event := memoryEvent(content.TenantID, "GeneratedContentCreated", "generated_content", content.ID, content.CreatedAt, map[string]any{"instruction_id": content.InstructionID})
	s.events[key(content.TenantID, event.ID)] = event
	return nil
}

func (s *MemoryStore) ListGeneratedContent(_ context.Context, tenantID, instructionID string) ([]core.GeneratedContent, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []core.GeneratedContent
	for _, content := range s.contents {
		if content.TenantID != tenantID {
			continue
		}
		if instructionID != "" && content.InstructionID != instructionID {
			continue
		}
		result = append(result, content)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].CreatedAt.Equal(result[j].CreatedAt) {
			return result[i].ID < result[j].ID
		}
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	return result, nil
}

func (s *MemoryStore) GetGeneratedContent(_ context.Context, tenantID, contentID string) (core.GeneratedContent, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	content, ok := s.contents[key(tenantID, contentID)]
	if !ok {
		return core.GeneratedContent{}, fmt.Errorf("%w: generated content", core.ErrNotFound)
	}
	return content, nil
}

func (s *MemoryStore) GetLLMConfiguration(_ context.Context, tenantID string) (core.LLMConfiguration, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	config, ok := s.llmConfigs[tenantID]
	if !ok {
		return core.LLMConfiguration{}, fmt.Errorf("%w: llm configuration", core.ErrNotFound)
	}
	return config, nil
}

func (s *MemoryStore) SaveLLMConfiguration(_ context.Context, config core.LLMConfiguration) (core.LLMConfiguration, error) {
	if config.TenantID == "" {
		return core.LLMConfiguration{}, fmt.Errorf("%w: tenant_id is required", core.ErrInvalidInput)
	}
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tenants[config.TenantID]; !ok {
		return core.LLMConfiguration{}, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	existing, ok := s.llmConfigs[config.TenantID]
	if ok {
		config.CreatedAt = existing.CreatedAt
	} else if config.CreatedAt.IsZero() {
		config.CreatedAt = now
	}
	if config.UpdatedAt.IsZero() {
		config.UpdatedAt = now
	}
	s.llmConfigs[config.TenantID] = config
	return config, nil
}

func (s *MemoryStore) ListSnapshots(_ context.Context, tenantID, learnerID string) ([]core.PedagogicalSnapshot, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []core.PedagogicalSnapshot
	for _, snapshot := range s.snapshots {
		if snapshot.TenantID == tenantID && snapshot.LearnerID == learnerID {
			result = append(result, snapshot)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.After(result[j].CreatedAt) })
	return result, nil
}

func (s *MemoryStore) ListAlerts(_ context.Context, tenantID string, now time.Time) ([]core.Alert, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var states []core.LearnerState
	for _, state := range s.states {
		if state.TenantID == tenantID {
			states = append(states, state)
		}
	}
	var interactions []core.Interaction
	for _, interaction := range s.interactions {
		if interaction.TenantID == tenantID {
			interactions = append(interactions, interaction)
		}
	}
	sort.Slice(interactions, func(i, j int) bool { return interactions[i].CreatedAt.After(interactions[j].CreatedAt) })
	if len(interactions) > 50 {
		interactions = interactions[:50]
	}
	for _, alert := range runtime.ComputeAlerts(states, interactions, now) {
		s.upsertAlertLocked(alert, now)
	}
	var alerts []core.Alert
	for _, alert := range s.alerts {
		if alert.TenantID == tenantID && alert.Status != "RESOLVED" {
			alerts = append(alerts, alert)
		}
	}
	sortAlerts(alerts)
	return alerts, nil
}

func (s *MemoryStore) UpdateAlertStatus(_ context.Context, tenantID, alertID, status string, now time.Time) (core.Alert, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	alert, ok := s.alerts[key(tenantID, alertID)]
	if !ok {
		return core.Alert{}, fmt.Errorf("%w: alert", core.ErrNotFound)
	}
	alert.Status = status
	alert.UpdatedAt = now
	s.alerts[key(tenantID, alertID)] = alert
	if status == "RESOLVED" {
		event := memoryEvent(tenantID, "AlertResolved", "alert", alertID, now, map[string]any{"alert_type": alert.AlertType, "learner_id": alert.LearnerID, "concept_id": alert.ConceptID})
		s.events[key(tenantID, event.ID)] = event
	}
	return alert, nil
}

func (s *MemoryStore) CohortAnalytics(_ context.Context, tenantID, cohortID string) (map[string]any, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.cohorts[key(tenantID, cohortID)]; !ok {
		return nil, fmt.Errorf("%w: cohort", core.ErrNotFound)
	}
	learners := map[string]bool{}
	for _, enrollment := range s.enrollments {
		if enrollment.TenantID == tenantID && enrollment.CohortID == cohortID {
			learners[enrollment.LearnerID] = true
		}
	}
	var totalMastery float64
	var stateCount int
	for _, state := range s.states {
		if state.TenantID == tenantID && learners[state.LearnerID] {
			totalMastery += state.Mastery
			stateCount++
		}
	}
	avg := 0.0
	if stateCount > 0 {
		avg = totalMastery / float64(stateCount)
	}
	return map[string]any{
		"tenant_id":       tenantID,
		"cohort_id":       cohortID,
		"learner_count":   len(learners),
		"state_count":     stateCount,
		"average_mastery": avg,
	}, nil
}

func (s *MemoryStore) GetIdempotencyRecord(_ context.Context, tenantID, idempotencyKey string) (core.IdempotencyRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	record, ok := s.idempotency[key(tenantID, idempotencyKey)]
	if !ok {
		return core.IdempotencyRecord{}, fmt.Errorf("%w: idempotency record", core.ErrNotFound)
	}
	return record, nil
}

func (s *MemoryStore) SaveIdempotencyRecord(_ context.Context, record core.IdempotencyRecord) error {
	if record.TenantID == "" || record.Key == "" || len(record.Response) == 0 {
		return fmt.Errorf("%w: invalid idempotency record", core.ErrInvalidInput)
	}
	if record.StatusCode <= 0 {
		record.StatusCode = 200
	}
	if record.CreatedAt.IsZero() {
		record.CreatedAt = time.Now().UTC()
	}
	record.Response = append([]byte(nil), record.Response...)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.idempotency[key(record.TenantID, record.Key)] = record
	return nil
}

func buildGraph(domain core.Domain, drafts []core.ConceptDraft, depDrafts []core.DependencyDraft) (core.DomainGraph, error) {
	if len(drafts) == 0 {
		return core.DomainGraph{}, fmt.Errorf("%w: at least one concept is required", core.ErrInvalidInput)
	}
	concepts := make([]core.Concept, 0, len(drafts))
	for _, draft := range drafts {
		if strings.TrimSpace(draft.Name) == "" {
			return core.DomainGraph{}, fmt.Errorf("%w: concept name is required", core.ErrInvalidInput)
		}
		id := draft.ID
		if id == "" {
			id = ids.New()
		}
		concepts = append(concepts, core.Concept{
			TenantID:    domain.TenantID,
			ID:          id,
			DomainID:    domain.ID,
			Name:        strings.TrimSpace(draft.Name),
			Description: draft.Description,
			Difficulty:  runtime.Clamp01(draft.Difficulty),
			CreatedAt:   domain.UpdatedAt,
		})
	}
	deps := make([]core.Dependency, 0, len(depDrafts))
	for _, draft := range depDrafts {
		deps = append(deps, core.Dependency{
			TenantID:        domain.TenantID,
			DomainID:        domain.ID,
			ParentConceptID: draft.ParentConceptID,
			ChildConceptID:  draft.ChildConceptID,
		})
	}
	return core.DomainGraph{Domain: domain, Concepts: concepts, Dependencies: deps}, nil
}

func memoryEvent(tenantID, eventType, aggregateType, aggregateID string, now time.Time, payload map[string]any) core.Event {
	eventID := ids.New()
	actorUserID := ""
	if value, ok := payload["actor_user_id"].(string); ok {
		actorUserID = value
	}
	return core.Event{
		TenantID:      tenantID,
		ID:            eventID,
		SchemaVersion: 1,
		ActorUserID:   actorUserID,
		CorrelationID: eventID,
		EventType:     eventType,
		AggregateType: aggregateType,
		AggregateID:   aggregateID,
		Payload:       payload,
		OccurredAt:    now,
	}
}

func (s *MemoryStore) upsertAlertLocked(alert core.Alert, now time.Time) {
	if alert.TenantID == "" || alert.LearnerID == "" || alert.AlertType == "" {
		return
	}
	dedupeKey := alertDedupeKey(alert)
	id, ok := s.alertDedupe[key(alert.TenantID, dedupeKey)]
	if ok {
		existing := s.alerts[key(alert.TenantID, id)]
		if existing.Status == "RESOLVED" {
			return
		}
		existing.Severity = alert.Severity
		existing.Payload = alert.Payload
		existing.RecommendedAction = alert.RecommendedAction
		existing.UpdatedAt = now
		s.alerts[key(alert.TenantID, existing.ID)] = existing
		return
	}
	if alert.ID == "" {
		alert.ID = ids.New()
	}
	if alert.Status == "" {
		alert.Status = "OPEN"
	}
	if alert.CreatedAt.IsZero() {
		alert.CreatedAt = now
	}
	if alert.UpdatedAt.IsZero() {
		alert.UpdatedAt = now
	}
	s.alerts[key(alert.TenantID, alert.ID)] = alert
	s.alertDedupe[key(alert.TenantID, dedupeKey)] = alert.ID
	event := memoryEvent(alert.TenantID, "AlertRaised", "alert", alert.ID, alert.CreatedAt, map[string]any{"alert_type": alert.AlertType, "learner_id": alert.LearnerID, "concept_id": alert.ConceptID})
	s.events[key(alert.TenantID, event.ID)] = event
}

func sortAlerts(alerts []core.Alert) {
	sort.Slice(alerts, func(i, j int) bool {
		if alertSeverityRank(alerts[i].Severity) == alertSeverityRank(alerts[j].Severity) {
			if alerts[i].CreatedAt.Equal(alerts[j].CreatedAt) {
				return alerts[i].ID < alerts[j].ID
			}
			return alerts[i].CreatedAt.After(alerts[j].CreatedAt)
		}
		return alertSeverityRank(alerts[i].Severity) < alertSeverityRank(alerts[j].Severity)
	})
}

func alertSeverityRank(severity string) int {
	switch severity {
	case "critical":
		return 0
	case "warning":
		return 1
	case "info":
		return 2
	default:
		return 3
	}
}

func alertDedupeKey(alert core.Alert) string {
	return strings.Join([]string{alert.LearnerID, alert.ConceptID, alert.AlertType}, "\x1f")
}

func key(parts ...string) string {
	return strings.Join(parts, "\x1f")
}
