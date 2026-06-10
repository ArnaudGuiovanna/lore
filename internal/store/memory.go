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
	sessions    map[string]core.TrainingSession
	adminAudit  map[string]core.AdminAuditLog
	syllabi     map[string]core.Syllabus
	bindings    map[string]core.SyllabusBinding

	domains      map[string]core.Domain
	concepts     map[string]core.Concept
	dependencies map[string]core.Dependency

	states         map[string]core.LearnerState
	activities     map[string]core.Activity
	instructions   map[string]core.TutorInstruction
	contents       map[string]core.GeneratedContent
	llmConfigs     map[string]core.LLMConfiguration
	interactions   map[string]core.Interaction
	evaluations    map[string]core.Evaluation
	misconceptions map[string]core.Misconception
	snapshots      map[string]core.PedagogicalSnapshot
	alerts         map[string]core.Alert
	alertDedupe    map[string]string
	events         map[string]core.Event
	idempotency    map[string]core.IdempotencyRecord
}

const maxTrackedActivityDuration = 4 * time.Hour

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		tenants:        map[string]core.Tenant{},
		users:          map[string]core.User{},
		memberships:    map[string]core.Membership{},
		programs:       map[string]core.Program{},
		cohorts:        map[string]core.Cohort{},
		enrollments:    map[string]core.CohortEnrollment{},
		sessions:       map[string]core.TrainingSession{},
		adminAudit:     map[string]core.AdminAuditLog{},
		syllabi:        map[string]core.Syllabus{},
		bindings:       map[string]core.SyllabusBinding{},
		domains:        map[string]core.Domain{},
		concepts:       map[string]core.Concept{},
		dependencies:   map[string]core.Dependency{},
		states:         map[string]core.LearnerState{},
		activities:     map[string]core.Activity{},
		instructions:   map[string]core.TutorInstruction{},
		contents:       map[string]core.GeneratedContent{},
		llmConfigs:     map[string]core.LLMConfiguration{},
		interactions:   map[string]core.Interaction{},
		evaluations:    map[string]core.Evaluation{},
		misconceptions: map[string]core.Misconception{},
		snapshots:      map[string]core.PedagogicalSnapshot{},
		alerts:         map[string]core.Alert{},
		alertDedupe:    map[string]string{},
		events:         map[string]core.Event{},
		idempotency:    map[string]core.IdempotencyRecord{},
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

func (s *MemoryStore) ListTenants(_ context.Context) ([]core.Tenant, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	tenants := make([]core.Tenant, 0, len(s.tenants))
	for _, tenant := range s.tenants {
		tenants = append(tenants, tenant)
	}
	sort.Slice(tenants, func(i, j int) bool {
		if tenants[i].CreatedAt.Equal(tenants[j].CreatedAt) {
			return tenants[i].ID < tenants[j].ID
		}
		return tenants[i].CreatedAt.Before(tenants[j].CreatedAt)
	})
	return tenants, nil
}

func (s *MemoryStore) CreateUser(_ context.Context, email, name string) (core.User, error) {
	if strings.TrimSpace(email) == "" {
		return core.User{}, fmt.Errorf("%w: email is required", core.ErrInvalidInput)
	}
	now := time.Now().UTC()
	user := core.User{ID: ids.New(), Email: strings.TrimSpace(email), Name: strings.TrimSpace(name), Status: "ACTIVE", CreatedAt: now, UpdatedAt: now}
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

func (s *MemoryStore) AddMembership(_ context.Context, tenantID, userID string, role core.Role, actorUserID ...string) (core.Membership, error) {
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
	_, existed := s.memberships[key(tenantID, userID)]
	now := time.Now().UTC()
	createdAt := now
	if existing, ok := s.memberships[key(tenantID, userID)]; ok {
		createdAt = existing.CreatedAt
	}
	membership := core.Membership{TenantID: tenantID, UserID: userID, Role: role, Status: "ACTIVE", CreatedAt: createdAt, UpdatedAt: now}
	s.memberships[key(tenantID, userID)] = membership
	if !existed {
		user := s.users[userID]
		event := memoryEvent(tenantID, "UserCreated", "user", userID, membership.CreatedAt, map[string]any{"user_id": userID, "email": user.Email})
		s.events[key(tenantID, event.ID)] = event
	}
	event := memoryEvent(tenantID, "MembershipChanged", "membership", userID, now, map[string]any{"user_id": userID, "role": role})
	s.events[key(tenantID, event.ID)] = event
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "membership.upsert", "membership", userID, map[string]any{"role": string(role)}, now)
	return membership, nil
}

func (s *MemoryStore) ListMemberships(_ context.Context, tenantID string) ([]core.Membership, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return nil, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	result := make([]core.Membership, 0)
	for _, membership := range s.memberships {
		if membership.TenantID == tenantID {
			result = append(result, membership)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].UserID < result[j].UserID })
	return result, nil
}

func (s *MemoryStore) ListTenantUsers(_ context.Context, tenantID string) ([]core.TenantUser, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return nil, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	users := make([]core.TenantUser, 0)
	for _, membership := range s.memberships {
		if membership.TenantID != tenantID {
			continue
		}
		user, ok := s.users[membership.UserID]
		if !ok {
			continue
		}
		users = append(users, tenantUserFrom(user, membership))
	}
	sortTenantUsers(users)
	return users, nil
}

func (s *MemoryStore) UpdateTenantUser(_ context.Context, tenantID, userID, email, name, status string, actorUserID ...string) (core.TenantUser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	membership, ok := s.memberships[key(tenantID, userID)]
	if !ok {
		return core.TenantUser{}, fmt.Errorf("%w: membership", core.ErrNotFound)
	}
	user, ok := s.users[userID]
	if !ok {
		return core.TenantUser{}, fmt.Errorf("%w: user", core.ErrNotFound)
	}
	if trimmed := strings.TrimSpace(email); trimmed != "" && !strings.EqualFold(trimmed, user.Email) {
		for _, existing := range s.users {
			if existing.ID != userID && strings.EqualFold(existing.Email, trimmed) {
				return core.TenantUser{}, fmt.Errorf("%w: user email already exists", core.ErrConflict)
			}
		}
		user.Email = trimmed
	}
	if strings.TrimSpace(name) != "" {
		user.Name = strings.TrimSpace(name)
	}
	if strings.TrimSpace(status) != "" {
		normalized, err := normalizeAdminStatus(status)
		if err != nil {
			return core.TenantUser{}, err
		}
		user.Status = normalized
		if normalized == "ARCHIVED" && user.ArchivedAt == nil {
			now := time.Now().UTC()
			user.ArchivedAt = &now
		}
		if normalized != "ARCHIVED" {
			user.ArchivedAt = nil
		}
	}
	now := time.Now().UTC()
	user.UpdatedAt = now
	s.users[userID] = user
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "user.update", "user", userID, map[string]any{"email": user.Email, "status": user.Status}, now)
	return tenantUserFrom(user, membership), nil
}

func (s *MemoryStore) ArchiveTenantUser(_ context.Context, tenantID, userID string, actorUserID ...string) (core.TenantUser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	membership, ok := s.memberships[key(tenantID, userID)]
	if !ok {
		return core.TenantUser{}, fmt.Errorf("%w: membership", core.ErrNotFound)
	}
	user, ok := s.users[userID]
	if !ok {
		return core.TenantUser{}, fmt.Errorf("%w: user", core.ErrNotFound)
	}
	now := time.Now().UTC()
	membership.Status = "ARCHIVED"
	membership.UpdatedAt = now
	if membership.ArchivedAt == nil {
		membership.ArchivedAt = &now
	}
	s.memberships[key(tenantID, userID)] = membership
	activeElsewhere := false
	for _, other := range s.memberships {
		if other.UserID == userID && other.TenantID != tenantID && other.Status == "ACTIVE" {
			activeElsewhere = true
			break
		}
	}
	if !activeElsewhere {
		user.Status = "ARCHIVED"
		user.UpdatedAt = now
		if user.ArchivedAt == nil {
			user.ArchivedAt = &now
		}
		s.users[userID] = user
	}
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "user.archive", "user", userID, nil, now)
	return tenantUserFrom(user, membership), nil
}

func (s *MemoryStore) ListLearners(_ context.Context, tenantID string) ([]core.Learner, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return nil, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	learners := make([]core.Learner, 0)
	for _, membership := range s.memberships {
		if membership.TenantID != tenantID || membership.Role != core.RoleLearner {
			continue
		}
		user, ok := s.users[membership.UserID]
		if !ok {
			continue
		}
		learners = append(learners, core.Learner{
			TenantID:            tenantID,
			UserID:              user.ID,
			Email:               user.Email,
			Name:                user.Name,
			UserStatus:          user.Status,
			MembershipStatus:    membership.Status,
			UserCreatedAt:       user.CreatedAt,
			MembershipCreatedAt: membership.CreatedAt,
		})
	}
	sort.Slice(learners, func(i, j int) bool {
		if strings.EqualFold(learners[i].Email, learners[j].Email) {
			return learners[i].UserID < learners[j].UserID
		}
		return strings.ToLower(learners[i].Email) < strings.ToLower(learners[j].Email)
	})
	return learners, nil
}

func (s *MemoryStore) CreateProgram(_ context.Context, tenantID, name string, actorUserID ...string) (core.Program, error) {
	if strings.TrimSpace(name) == "" {
		return core.Program{}, fmt.Errorf("%w: program name is required", core.ErrInvalidInput)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return core.Program{}, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	now := time.Now().UTC()
	program := core.Program{TenantID: tenantID, ID: ids.New(), Name: strings.TrimSpace(name), Status: "ACTIVE", CreatedAt: now, UpdatedAt: now}
	s.programs[key(tenantID, program.ID)] = program
	event := memoryEvent(tenantID, "ProgramCreated", "program", program.ID, program.CreatedAt, map[string]any{"name": program.Name})
	s.events[key(tenantID, event.ID)] = event
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "program.create", "program", program.ID, map[string]any{"name": program.Name}, now)
	return program, nil
}

func (s *MemoryStore) ListPrograms(_ context.Context, tenantID string) ([]core.Program, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return nil, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	programs := make([]core.Program, 0)
	for _, program := range s.programs {
		if program.TenantID == tenantID {
			programs = append(programs, program)
		}
	}
	sort.Slice(programs, func(i, j int) bool {
		if programs[i].CreatedAt.Equal(programs[j].CreatedAt) {
			return programs[i].ID < programs[j].ID
		}
		return programs[i].CreatedAt.Before(programs[j].CreatedAt)
	})
	return programs, nil
}

func (s *MemoryStore) UpdateProgram(_ context.Context, tenantID, programID, name, status string, actorUserID ...string) (core.Program, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	program, ok := s.programs[key(tenantID, programID)]
	if !ok {
		return core.Program{}, fmt.Errorf("%w: program", core.ErrNotFound)
	}
	if strings.TrimSpace(name) != "" {
		program.Name = strings.TrimSpace(name)
	}
	if strings.TrimSpace(status) != "" {
		normalized, err := normalizeAdminStatus(status)
		if err != nil {
			return core.Program{}, err
		}
		program.Status = normalized
		if normalized != "ARCHIVED" {
			program.ArchivedAt = nil
		}
	}
	now := time.Now().UTC()
	program.UpdatedAt = now
	if program.Status == "ARCHIVED" && program.ArchivedAt == nil {
		program.ArchivedAt = &now
	}
	s.programs[key(tenantID, programID)] = program
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "program.update", "program", programID, map[string]any{"name": program.Name, "status": program.Status}, now)
	return program, nil
}

func (s *MemoryStore) ArchiveProgram(_ context.Context, tenantID, programID string, actorUserID ...string) (core.Program, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	program, ok := s.programs[key(tenantID, programID)]
	if !ok {
		return core.Program{}, fmt.Errorf("%w: program", core.ErrNotFound)
	}
	now := time.Now().UTC()
	program.Status = "ARCHIVED"
	program.UpdatedAt = now
	if program.ArchivedAt == nil {
		program.ArchivedAt = &now
	}
	s.programs[key(tenantID, programID)] = program
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "program.archive", "program", programID, nil, now)
	return program, nil
}

func (s *MemoryStore) CreateCohort(_ context.Context, tenantID, programID, name string, start, end time.Time, actorUserID ...string) (core.Cohort, error) {
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
	now := time.Now().UTC()
	cohort := core.Cohort{TenantID: tenantID, ID: ids.New(), ProgramID: programID, Name: strings.TrimSpace(name), StartDate: start, EndDate: end, Status: "ACTIVE", CreatedAt: now, UpdatedAt: now}
	s.cohorts[key(tenantID, cohort.ID)] = cohort
	event := memoryEvent(tenantID, "CohortCreated", "cohort", cohort.ID, cohort.CreatedAt, map[string]any{"program_id": programID, "name": cohort.Name})
	s.events[key(tenantID, event.ID)] = event
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "cohort.create", "cohort", cohort.ID, map[string]any{"program_id": programID, "name": cohort.Name}, now)
	return cohort, nil
}

func (s *MemoryStore) ListCohorts(_ context.Context, tenantID string) ([]core.Cohort, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return nil, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	cohorts := make([]core.Cohort, 0)
	for _, cohort := range s.cohorts {
		if cohort.TenantID == tenantID {
			cohorts = append(cohorts, cohort)
		}
	}
	sort.Slice(cohorts, func(i, j int) bool {
		if cohorts[i].CreatedAt.Equal(cohorts[j].CreatedAt) {
			return cohorts[i].ID < cohorts[j].ID
		}
		return cohorts[i].CreatedAt.Before(cohorts[j].CreatedAt)
	})
	return cohorts, nil
}

func (s *MemoryStore) UpdateCohort(_ context.Context, tenantID, cohortID, programID, name, status string, start, end time.Time, actorUserID ...string) (core.Cohort, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cohort, ok := s.cohorts[key(tenantID, cohortID)]
	if !ok {
		return core.Cohort{}, fmt.Errorf("%w: cohort", core.ErrNotFound)
	}
	if strings.TrimSpace(programID) != "" {
		if _, ok := s.programs[key(tenantID, programID)]; !ok {
			return core.Cohort{}, fmt.Errorf("%w: program", core.ErrNotFound)
		}
		cohort.ProgramID = strings.TrimSpace(programID)
	}
	if strings.TrimSpace(name) != "" {
		cohort.Name = strings.TrimSpace(name)
	}
	if !start.IsZero() {
		cohort.StartDate = start
	}
	if !end.IsZero() {
		cohort.EndDate = end
	}
	if strings.TrimSpace(status) != "" {
		normalized, err := normalizeAdminStatus(status)
		if err != nil {
			return core.Cohort{}, err
		}
		cohort.Status = normalized
		if normalized != "ARCHIVED" {
			cohort.ArchivedAt = nil
		}
	}
	now := time.Now().UTC()
	cohort.UpdatedAt = now
	if cohort.Status == "ARCHIVED" && cohort.ArchivedAt == nil {
		cohort.ArchivedAt = &now
	}
	s.cohorts[key(tenantID, cohortID)] = cohort
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "cohort.update", "cohort", cohortID, map[string]any{"program_id": cohort.ProgramID, "status": cohort.Status}, now)
	return cohort, nil
}

func (s *MemoryStore) ArchiveCohort(_ context.Context, tenantID, cohortID string, actorUserID ...string) (core.Cohort, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cohort, ok := s.cohorts[key(tenantID, cohortID)]
	if !ok {
		return core.Cohort{}, fmt.Errorf("%w: cohort", core.ErrNotFound)
	}
	now := time.Now().UTC()
	cohort.Status = "ARCHIVED"
	cohort.UpdatedAt = now
	if cohort.ArchivedAt == nil {
		cohort.ArchivedAt = &now
	}
	s.cohorts[key(tenantID, cohortID)] = cohort
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "cohort.archive", "cohort", cohortID, nil, now)
	return cohort, nil
}

func (s *MemoryStore) EnrollLearner(_ context.Context, tenantID, cohortID, learnerID string, actorUserID ...string) (core.CohortEnrollment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.cohorts[key(tenantID, cohortID)]; !ok {
		return core.CohortEnrollment{}, fmt.Errorf("%w: cohort", core.ErrNotFound)
	}
	now := time.Now().UTC()
	createdAt := now
	if existing, ok := s.enrollments[key(tenantID, cohortID, learnerID)]; ok {
		createdAt = existing.CreatedAt
	}
	enrollment := core.CohortEnrollment{TenantID: tenantID, CohortID: cohortID, LearnerID: learnerID, Status: "ACTIVE", CreatedAt: createdAt, UpdatedAt: now}
	s.enrollments[key(tenantID, cohortID, learnerID)] = enrollment
	event := memoryEvent(tenantID, "LearnerEnrolled", "cohort_enrollment", cohortID, enrollment.CreatedAt, map[string]any{"cohort_id": cohortID, "learner_id": learnerID})
	s.events[key(tenantID, event.ID)] = event
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "enrollment.upsert", "cohort_enrollment", cohortID+":"+learnerID, map[string]any{"cohort_id": cohortID, "learner_id": learnerID}, now)
	return enrollment, nil
}

func (s *MemoryStore) ListCohortEnrollments(_ context.Context, tenantID, cohortID string) ([]core.CohortEnrollment, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.cohorts[key(tenantID, cohortID)]; !ok {
		return nil, fmt.Errorf("%w: cohort", core.ErrNotFound)
	}
	enrollments := make([]core.CohortEnrollment, 0)
	for _, enrollment := range s.enrollments {
		if enrollment.TenantID == tenantID && enrollment.CohortID == cohortID {
			enrollments = append(enrollments, enrollment)
		}
	}
	sort.Slice(enrollments, func(i, j int) bool { return enrollments[i].LearnerID < enrollments[j].LearnerID })
	return enrollments, nil
}

func (s *MemoryStore) UpdateCohortEnrollmentStatus(_ context.Context, tenantID, cohortID, learnerID, status string, actorUserID ...string) (core.CohortEnrollment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	enrollment, ok := s.enrollments[key(tenantID, cohortID, learnerID)]
	if !ok {
		return core.CohortEnrollment{}, fmt.Errorf("%w: enrollment", core.ErrNotFound)
	}
	normalized, err := normalizeAdminStatus(status)
	if err != nil {
		return core.CohortEnrollment{}, err
	}
	now := time.Now().UTC()
	enrollment.Status = normalized
	enrollment.UpdatedAt = now
	if normalized == "ARCHIVED" && enrollment.ArchivedAt == nil {
		enrollment.ArchivedAt = &now
	}
	if normalized != "ARCHIVED" {
		enrollment.ArchivedAt = nil
	}
	s.enrollments[key(tenantID, cohortID, learnerID)] = enrollment
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "enrollment.update", "cohort_enrollment", cohortID+":"+learnerID, map[string]any{"status": normalized}, now)
	return enrollment, nil
}

func (s *MemoryStore) ArchiveCohortEnrollment(ctx context.Context, tenantID, cohortID, learnerID string, actorUserID ...string) (core.CohortEnrollment, error) {
	return s.UpdateCohortEnrollmentStatus(ctx, tenantID, cohortID, learnerID, "ARCHIVED", actorUserID...)
}

func (s *MemoryStore) CreateTrainingSession(_ context.Context, session core.TrainingSession, actorUserID ...string) (core.TrainingSession, error) {
	if err := validateTrainingSession(session); err != nil {
		return core.TrainingSession{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	cohort, ok := s.cohorts[key(session.TenantID, session.CohortID)]
	if !ok {
		return core.TrainingSession{}, fmt.Errorf("%w: cohort", core.ErrNotFound)
	}
	now := time.Now().UTC()
	session.ID = ids.New()
	session.ProgramID = cohort.ProgramID
	session.Title = strings.TrimSpace(session.Title)
	session.Location = strings.TrimSpace(session.Location)
	session.VideoURL = strings.TrimSpace(session.VideoURL)
	session.Status = "SCHEDULED"
	session.CreatedAt = now
	session.UpdatedAt = now
	s.sessions[key(session.TenantID, session.ID)] = session
	s.recordAdminAuditLocked(session.TenantID, firstActor(actorUserID), "training_session.create", "training_session", session.ID, map[string]any{"cohort_id": session.CohortID}, now)
	return session, nil
}

func (s *MemoryStore) ListTrainingSessions(_ context.Context, tenantID, cohortID string) ([]core.TrainingSession, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return nil, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	if cohortID != "" {
		if _, ok := s.cohorts[key(tenantID, cohortID)]; !ok {
			return nil, fmt.Errorf("%w: cohort", core.ErrNotFound)
		}
	}
	sessions := make([]core.TrainingSession, 0)
	for _, session := range s.sessions {
		if session.TenantID != tenantID {
			continue
		}
		if cohortID != "" && session.CohortID != cohortID {
			continue
		}
		sessions = append(sessions, session)
	}
	sort.Slice(sessions, func(i, j int) bool {
		if sessions[i].StartsAt.Equal(sessions[j].StartsAt) {
			return sessions[i].ID < sessions[j].ID
		}
		return sessions[i].StartsAt.Before(sessions[j].StartsAt)
	})
	return sessions, nil
}

func (s *MemoryStore) UpdateTrainingSession(_ context.Context, tenantID, sessionID string, patch core.TrainingSessionPatch, actorUserID ...string) (core.TrainingSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[key(tenantID, sessionID)]
	if !ok {
		return core.TrainingSession{}, fmt.Errorf("%w: training session", core.ErrNotFound)
	}
	if patch.CohortID != nil {
		cohortID := strings.TrimSpace(*patch.CohortID)
		cohort, ok := s.cohorts[key(tenantID, cohortID)]
		if !ok {
			return core.TrainingSession{}, fmt.Errorf("%w: cohort", core.ErrNotFound)
		}
		session.CohortID = cohortID
		session.ProgramID = cohort.ProgramID
	}
	if patch.Title != nil {
		session.Title = strings.TrimSpace(*patch.Title)
	}
	if patch.StartsAt != nil {
		session.StartsAt = patch.StartsAt.UTC()
	}
	if patch.EndsAt != nil {
		session.EndsAt = patch.EndsAt.UTC()
	}
	if patch.Capacity != nil {
		session.Capacity = *patch.Capacity
	}
	if patch.Location != nil {
		session.Location = strings.TrimSpace(*patch.Location)
	}
	if patch.VideoURL != nil {
		session.VideoURL = strings.TrimSpace(*patch.VideoURL)
	}
	if patch.Status != nil {
		normalized, err := normalizeSessionStatus(*patch.Status)
		if err != nil {
			return core.TrainingSession{}, err
		}
		session.Status = normalized
		if normalized != "ARCHIVED" {
			session.ArchivedAt = nil
		}
	}
	if err := validateTrainingSession(session); err != nil {
		return core.TrainingSession{}, err
	}
	now := time.Now().UTC()
	session.UpdatedAt = now
	if session.Status == "ARCHIVED" && session.ArchivedAt == nil {
		session.ArchivedAt = &now
	}
	s.sessions[key(tenantID, sessionID)] = session
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "training_session.update", "training_session", sessionID, map[string]any{"cohort_id": session.CohortID, "status": session.Status}, now)
	return session, nil
}

func (s *MemoryStore) ArchiveTrainingSession(_ context.Context, tenantID, sessionID string, actorUserID ...string) (core.TrainingSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[key(tenantID, sessionID)]
	if !ok {
		return core.TrainingSession{}, fmt.Errorf("%w: training session", core.ErrNotFound)
	}
	now := time.Now().UTC()
	session.Status = "ARCHIVED"
	session.UpdatedAt = now
	if session.ArchivedAt == nil {
		session.ArchivedAt = &now
	}
	s.sessions[key(tenantID, sessionID)] = session
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "training_session.archive", "training_session", sessionID, nil, now)
	return session, nil
}

func (s *MemoryStore) ListAdminAuditLogs(_ context.Context, tenantID, targetType, targetID string) ([]core.AdminAuditLog, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return nil, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	logs := make([]core.AdminAuditLog, 0)
	for _, log := range s.adminAudit {
		if log.TenantID != tenantID {
			continue
		}
		if targetType != "" && log.TargetType != targetType {
			continue
		}
		if targetID != "" && log.TargetID != targetID {
			continue
		}
		logs = append(logs, log)
	}
	sort.Slice(logs, func(i, j int) bool {
		if logs[i].CreatedAt.Equal(logs[j].CreatedAt) {
			return logs[i].ID < logs[j].ID
		}
		return logs[i].CreatedAt.Before(logs[j].CreatedAt)
	})
	return logs, nil
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

func (s *MemoryStore) ListSyllabi(_ context.Context, tenantID string) ([]core.Syllabus, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return nil, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	syllabi := make([]core.Syllabus, 0)
	for _, syllabus := range s.syllabi {
		if syllabus.TenantID == tenantID {
			syllabi = append(syllabi, syllabus)
		}
	}
	sort.Slice(syllabi, func(i, j int) bool {
		if syllabi[i].CreatedAt.Equal(syllabi[j].CreatedAt) {
			return syllabi[i].ID < syllabi[j].ID
		}
		return syllabi[i].CreatedAt.Before(syllabi[j].CreatedAt)
	})
	return syllabi, nil
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
	graphEvent := memoryEvent(tenantID, "ConceptGraphPublished", "domain", domain.ID, domain.CreatedAt, map[string]any{"graph_version": domain.GraphVersion})
	s.events[key(tenantID, graphEvent.ID)] = graphEvent
	return graph, nil
}

func (s *MemoryStore) ListDomains(_ context.Context, tenantID string) ([]core.Domain, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return nil, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	domains := make([]core.Domain, 0)
	for _, domain := range s.domains {
		if domain.TenantID == tenantID {
			domains = append(domains, domain)
		}
	}
	sort.Slice(domains, func(i, j int) bool {
		if domains[i].CreatedAt.Equal(domains[j].CreatedAt) {
			return domains[i].ID < domains[j].ID
		}
		return domains[i].CreatedAt.Before(domains[j].CreatedAt)
	})
	return domains, nil
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

func (s *MemoryStore) ListActiveMisconceptions(_ context.Context, tenantID, learnerID, domainID string) ([]core.Misconception, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []core.Misconception
	for _, misconception := range s.misconceptions {
		if misconception.TenantID != tenantID || misconception.LearnerID != learnerID || misconception.Status != "ACTIVE" {
			continue
		}
		if _, ok := s.concepts[key(tenantID, domainID, misconception.ConceptID)]; !ok {
			continue
		}
		result = append(result, misconception)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Severity == result[j].Severity {
			if result[i].CreatedAt.Equal(result[j].CreatedAt) {
				return result[i].ID < result[j].ID
			}
			return result[i].CreatedAt.Before(result[j].CreatedAt)
		}
		return result[i].Severity > result[j].Severity
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

func (s *MemoryStore) PauseActivity(_ context.Context, tenantID, activityID string) (core.Activity, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	activity, ok := s.activities[key(tenantID, activityID)]
	if !ok {
		return core.Activity{}, fmt.Errorf("%w: activity", core.ErrNotFound)
	}
	if activity.Status != core.ActivityStarted || activity.CompletedAt != nil {
		return core.Activity{}, fmt.Errorf("%w: only a started activity can be paused", core.ErrInvalidInput)
	}
	now := time.Now().UTC()
	if activity.PausedAt == nil {
		activity.PausedAt = &now
	}
	s.activities[key(tenantID, activityID)] = activity
	event := memoryEvent(tenantID, "ActivityPaused", "activity", activityID, now, map[string]any{"learner_id": activity.LearnerID})
	s.events[key(tenantID, event.ID)] = event
	return activity, nil
}

func (s *MemoryStore) ResumeActivity(_ context.Context, tenantID, activityID string) (core.Activity, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	activity, ok := s.activities[key(tenantID, activityID)]
	if !ok {
		return core.Activity{}, fmt.Errorf("%w: activity", core.ErrNotFound)
	}
	if activity.Status != core.ActivityStarted || activity.CompletedAt != nil {
		return core.Activity{}, fmt.Errorf("%w: only a started activity can be resumed", core.ErrInvalidInput)
	}
	now := time.Now().UTC()
	if activity.PausedAt != nil {
		if now.After(*activity.PausedAt) {
			activity.PausedSeconds += int64(now.Sub(*activity.PausedAt).Seconds())
		}
		activity.PausedAt = nil
	}
	s.activities[key(tenantID, activityID)] = activity
	event := memoryEvent(tenantID, "ActivityResumed", "activity", activityID, now, map[string]any{"learner_id": activity.LearnerID})
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
	stored, ok := s.activities[key(activity.TenantID, activity.ID)]
	if !ok {
		return fmt.Errorf("%w: activity", core.ErrNotFound)
	}
	// Preserve pause accounting recorded since the engine read the activity, and
	// fold any still-open pause into paused_seconds at completion.
	activity.PausedSeconds = stored.PausedSeconds
	activity.PausedAt = stored.PausedAt
	if activity.CompletedAt != nil && activity.PausedAt != nil {
		if activity.CompletedAt.After(*activity.PausedAt) {
			activity.PausedSeconds += int64(activity.CompletedAt.Sub(*activity.PausedAt).Seconds())
		}
		activity.PausedAt = nil
	}
	s.activities[key(activity.TenantID, activity.ID)] = activity
	s.interactions[key(delta.Interaction.TenantID, delta.Interaction.ID)] = delta.Interaction
	s.evaluations[key(delta.Evaluation.TenantID, delta.Evaluation.ID)] = delta.Evaluation
	s.states[key(delta.After.TenantID, delta.After.LearnerID, delta.After.ConceptID)] = delta.After
	for _, misconception := range delta.Misconceptions {
		if misconception.TenantID != activity.TenantID {
			return fmt.Errorf("%w: misconception", core.ErrTenantMismatch)
		}
		if misconception.ID == "" {
			return fmt.Errorf("%w: misconception id is required", core.ErrInvalidInput)
		}
		s.misconceptions[key(misconception.TenantID, misconception.ID)] = misconception
	}
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

func (s *MemoryStore) GetLLMConfiguration(_ context.Context, tenantID, scopeType, scopeID string) (core.LLMConfiguration, error) {
	scopeType, scopeID, err := normalizeLLMScope(scopeType, scopeID)
	if err != nil {
		return core.LLMConfiguration{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	config, ok := s.llmConfigs[key(tenantID, scopeType, scopeID)]
	if !ok {
		return core.LLMConfiguration{}, fmt.Errorf("%w: llm configuration", core.ErrNotFound)
	}
	return config, nil
}

func (s *MemoryStore) SaveLLMConfiguration(_ context.Context, config core.LLMConfiguration) (core.LLMConfiguration, error) {
	if config.TenantID == "" {
		return core.LLMConfiguration{}, fmt.Errorf("%w: tenant_id is required", core.ErrInvalidInput)
	}
	scopeType, scopeID, err := normalizeLLMScope(config.ScopeType, config.ScopeID)
	if err != nil {
		return core.LLMConfiguration{}, err
	}
	config.ScopeType = scopeType
	config.ScopeID = scopeID
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tenants[config.TenantID]; !ok {
		return core.LLMConfiguration{}, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	existing, ok := s.llmConfigs[key(config.TenantID, config.ScopeType, config.ScopeID)]
	if ok {
		config.CreatedAt = existing.CreatedAt
	} else if config.CreatedAt.IsZero() {
		config.CreatedAt = now
	}
	if config.UpdatedAt.IsZero() {
		config.UpdatedAt = now
	}
	s.llmConfigs[key(config.TenantID, config.ScopeType, config.ScopeID)] = config
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
	cohort, ok := s.cohorts[key(tenantID, cohortID)]
	if !ok {
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
	activeMisconceptions := 0
	for _, misconception := range s.misconceptions {
		if misconception.TenantID == tenantID && misconception.Status == "ACTIVE" && learners[misconception.LearnerID] {
			activeMisconceptions++
		}
	}
	avg := 0.0
	if stateCount > 0 {
		avg = totalMastery / float64(stateCount)
	}
	learnerTime := make(map[string]core.TrainingTimeSummary, len(learners))
	for learnerID := range learners {
		learnerTime[learnerID] = core.TrainingTimeSummary{
			TenantID:  tenantID,
			ProgramID: cohort.ProgramID,
			CohortID:  cohortID,
			LearnerID: learnerID,
		}
	}
	var totalSeconds int64
	for _, activity := range s.activities {
		if activity.TenantID != tenantID || !learners[activity.LearnerID] {
			continue
		}
		seconds := trackedActivitySeconds(activity.StartedAt, activity.CompletedAt, activity.PausedSeconds)
		if seconds <= 0 {
			continue
		}
		summary := learnerTime[activity.LearnerID]
		summary.ActivityCount++
		summary.TrainingTimeSeconds += seconds
		summary.TrainingHours = hoursFromSeconds(summary.TrainingTimeSeconds)
		learnerTime[activity.LearnerID] = summary
		totalSeconds += seconds
	}
	learnerSummaries := make([]core.TrainingTimeSummary, 0, len(learnerTime))
	for _, summary := range learnerTime {
		learnerSummaries = append(learnerSummaries, summary)
	}
	sort.Slice(learnerSummaries, func(i, j int) bool { return learnerSummaries[i].LearnerID < learnerSummaries[j].LearnerID })
	return map[string]any{
		"tenant_id":             tenantID,
		"program_id":            cohort.ProgramID,
		"cohort_id":             cohortID,
		"learner_count":         len(learners),
		"state_count":           stateCount,
		"average_mastery":       avg,
		"active_misconceptions": activeMisconceptions,
		"training_time_seconds": totalSeconds,
		"training_hours":        hoursFromSeconds(totalSeconds),
		"learner_time":          learnerSummaries,
	}, nil
}

// CohortProgress builds the per-learner progress export rows (B-12/B-22).
// Mastered = states whose mastery reaches the runtime threshold passed in by
// the caller (the store does not own pedagogy constants).
func (s *MemoryStore) CohortProgress(_ context.Context, tenantID, cohortID string, masteryThreshold float64) ([]core.LearnerProgressSummary, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.cohorts[key(tenantID, cohortID)]; !ok {
		return nil, fmt.Errorf("%w: cohort", core.ErrNotFound)
	}
	learners := map[string]bool{}
	for _, enrollment := range s.enrollments {
		if enrollment.TenantID == tenantID && enrollment.CohortID == cohortID && enrollment.Status == "ACTIVE" {
			learners[enrollment.LearnerID] = true
		}
	}
	byLearner := map[string]*core.LearnerProgressSummary{}
	for learnerID := range learners {
		byLearner[learnerID] = &core.LearnerProgressSummary{TenantID: tenantID, CohortID: cohortID, LearnerID: learnerID}
	}
	for _, state := range s.states {
		if state.TenantID != tenantID || !learners[state.LearnerID] {
			continue
		}
		row := byLearner[state.LearnerID]
		row.ConceptsTracked++
		if state.Mastery >= masteryThreshold {
			row.ConceptsMastered++
		}
		row.AvgMastery += state.Mastery
		row.AvgRetention += state.Retention
	}
	for _, activity := range s.activities {
		if activity.TenantID != tenantID || !learners[activity.LearnerID] {
			continue
		}
		seconds := trackedActivitySeconds(activity.StartedAt, activity.CompletedAt, activity.PausedSeconds)
		if seconds <= 0 {
			continue
		}
		row := byLearner[activity.LearnerID]
		row.ActivityCount++
		row.TrainingTimeSeconds += seconds
	}
	rows := make([]core.LearnerProgressSummary, 0, len(byLearner))
	for _, row := range byLearner {
		if row.ConceptsTracked > 0 {
			row.AvgMastery /= float64(row.ConceptsTracked)
			row.AvgRetention /= float64(row.ConceptsTracked)
		}
		row.TrainingHours = hoursFromSeconds(row.TrainingTimeSeconds)
		rows = append(rows, *row)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].LearnerID < rows[j].LearnerID })
	return rows, nil
}

func trackedActivitySeconds(startedAt, completedAt *time.Time, pausedSeconds int64) int64 {
	if startedAt == nil || completedAt == nil || !completedAt.After(*startedAt) {
		return 0
	}
	seconds := int64(completedAt.Sub(*startedAt).Seconds()) - pausedSeconds
	if seconds < 0 {
		seconds = 0
	}
	if cap := int64(maxTrackedActivityDuration.Seconds()); seconds > cap {
		seconds = cap
	}
	return seconds
}

func hoursFromSeconds(seconds int64) float64 {
	return float64(seconds) / 3600
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
	if eventType, aggregateType, aggregateID, ok := alertDomainEvent(alert); ok {
		domainEvent := memoryEvent(alert.TenantID, eventType, aggregateType, aggregateID, alert.CreatedAt, alertEventPayload(alert))
		s.events[key(alert.TenantID, domainEvent.ID)] = domainEvent
	}
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

func alertDomainEvent(alert core.Alert) (eventType, aggregateType, aggregateID string, ok bool) {
	switch alert.AlertType {
	case "ReviewDue":
		return "ReviewDue", "review_card", alert.ConceptID, true
	case "LearnerAtRisk":
		return "LearnerAtRisk", "learner", alert.LearnerID, true
	default:
		return "", "", "", false
	}
}

func alertEventPayload(alert core.Alert) map[string]any {
	return map[string]any{
		"alert_id":   alert.ID,
		"alert_type": alert.AlertType,
		"learner_id": alert.LearnerID,
		"concept_id": alert.ConceptID,
		"severity":   alert.Severity,
	}
}

func alertDedupeKey(alert core.Alert) string {
	return strings.Join([]string{alert.LearnerID, alert.ConceptID, alert.AlertType}, "\x1f")
}

func tenantUserFrom(user core.User, membership core.Membership) core.TenantUser {
	userUpdatedAt := user.UpdatedAt
	if userUpdatedAt.IsZero() {
		userUpdatedAt = user.CreatedAt
	}
	membershipUpdatedAt := membership.UpdatedAt
	if membershipUpdatedAt.IsZero() {
		membershipUpdatedAt = membership.CreatedAt
	}
	return core.TenantUser{
		TenantID:             membership.TenantID,
		UserID:               user.ID,
		Email:                user.Email,
		Name:                 user.Name,
		UserStatus:           user.Status,
		Role:                 membership.Role,
		MembershipStatus:     membership.Status,
		UserCreatedAt:        user.CreatedAt,
		UserUpdatedAt:        userUpdatedAt,
		UserArchivedAt:       user.ArchivedAt,
		MembershipCreatedAt:  membership.CreatedAt,
		MembershipUpdatedAt:  membershipUpdatedAt,
		MembershipArchivedAt: membership.ArchivedAt,
	}
}

func sortTenantUsers(users []core.TenantUser) {
	sort.Slice(users, func(i, j int) bool {
		if strings.EqualFold(users[i].Email, users[j].Email) {
			return users[i].UserID < users[j].UserID
		}
		return strings.ToLower(users[i].Email) < strings.ToLower(users[j].Email)
	})
}

func firstActor(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return strings.TrimSpace(values[0])
}

func normalizeAdminStatus(status string) (string, error) {
	normalized := strings.ToUpper(strings.TrimSpace(status))
	switch normalized {
	case "ACTIVE", "INVITED", "DRAFT", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "SUSPENDED", "CANCELLED", "DROPPED", "ARCHIVED":
		return normalized, nil
	default:
		return "", fmt.Errorf("%w: unsupported status %q", core.ErrInvalidInput, status)
	}
}

func normalizeSessionStatus(status string) (string, error) {
	normalized := strings.ToUpper(strings.TrimSpace(status))
	switch normalized {
	case "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "ARCHIVED":
		return normalized, nil
	default:
		return "", fmt.Errorf("%w: unsupported training session status %q", core.ErrInvalidInput, status)
	}
}

func validateTrainingSession(session core.TrainingSession) error {
	if strings.TrimSpace(session.TenantID) == "" {
		return fmt.Errorf("%w: tenant_id is required", core.ErrInvalidInput)
	}
	if strings.TrimSpace(session.CohortID) == "" {
		return fmt.Errorf("%w: cohort_id is required", core.ErrInvalidInput)
	}
	if strings.TrimSpace(session.Title) == "" {
		return fmt.Errorf("%w: training session title is required", core.ErrInvalidInput)
	}
	if session.StartsAt.IsZero() {
		return fmt.Errorf("%w: starts_at is required", core.ErrInvalidInput)
	}
	if session.EndsAt.IsZero() {
		return fmt.Errorf("%w: ends_at is required", core.ErrInvalidInput)
	}
	if !session.EndsAt.After(session.StartsAt) {
		return fmt.Errorf("%w: ends_at must be after starts_at", core.ErrInvalidInput)
	}
	if session.Capacity < 0 {
		return fmt.Errorf("%w: capacity must be non-negative", core.ErrInvalidInput)
	}
	if session.Status != "" {
		if _, err := normalizeSessionStatus(session.Status); err != nil {
			return err
		}
	}
	return nil
}

func (s *MemoryStore) recordAdminAuditLocked(tenantID, actorUserID, action, targetType, targetID string, payload map[string]any, now time.Time) core.AdminAuditLog {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if payload == nil {
		payload = map[string]any{}
	}
	log := core.AdminAuditLog{
		TenantID:    tenantID,
		ID:          ids.New(),
		ActorUserID: actorUserID,
		Action:      action,
		TargetType:  targetType,
		TargetID:    targetID,
		Payload:     payload,
		CreatedAt:   now,
	}
	s.adminAudit[key(tenantID, log.ID)] = log
	return log
}

func normalizeLLMScope(scopeType, scopeID string) (string, string, error) {
	scopeType = strings.ToLower(strings.TrimSpace(scopeType))
	scopeID = strings.TrimSpace(scopeID)
	if scopeType == "" {
		scopeType = "tenant"
	}
	switch scopeType {
	case "tenant":
		if scopeID != "" {
			return "", "", fmt.Errorf("%w: tenant-scoped llm configuration must not set scope_id", core.ErrInvalidInput)
		}
		return scopeType, "", nil
	case "program", "cohort", "learner":
		if scopeID == "" {
			return "", "", fmt.Errorf("%w: scope_id is required for %s llm configuration", core.ErrInvalidInput, scopeType)
		}
		return scopeType, scopeID, nil
	default:
		return "", "", fmt.Errorf("%w: unsupported llm configuration scope %q", core.ErrInvalidInput, scopeType)
	}
}

func key(parts ...string) string {
	return strings.Join(parts, "\x1f")
}
