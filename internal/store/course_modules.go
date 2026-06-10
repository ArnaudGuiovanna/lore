package store

// B-24: editorial course modules. Shared validation + path computation live
// here so the memory and Postgres stores cannot drift: both load the modules
// and learner states, then derive the path with the exact same rules.

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"lore/internal/core"
	"lore/internal/ids"
)

// validateCourseModule enforces the editorial invariants. Prerequisites must
// point at existing modules of the same syllabus with a strictly lower
// position — that single rule guarantees the module graph stays acyclic.
func validateCourseModule(module core.CourseModule, siblings []core.CourseModule) error {
	if strings.TrimSpace(module.Title) == "" {
		return fmt.Errorf("%w: module title is required", core.ErrInvalidInput)
	}
	if module.Position < 0 {
		return fmt.Errorf("%w: module position must be >= 0", core.ErrInvalidInput)
	}
	if module.RequiredMastery <= 0 || module.RequiredMastery > 1 {
		return fmt.Errorf("%w: required_mastery must be in (0,1]", core.ErrInvalidInput)
	}
	for _, conceptID := range module.ConceptIDs {
		if strings.TrimSpace(conceptID) == "" {
			return fmt.Errorf("%w: concept ids must be non-empty", core.ErrInvalidInput)
		}
	}
	byID := make(map[string]core.CourseModule, len(siblings))
	for _, sibling := range siblings {
		byID[sibling.ID] = sibling
	}
	for _, prereqID := range module.PrerequisiteIDs {
		prereq, ok := byID[prereqID]
		if !ok || prereq.ID == module.ID {
			return fmt.Errorf("%w: prerequisite %q is not a module of this syllabus", core.ErrInvalidInput, prereqID)
		}
		if prereq.Position >= module.Position {
			return fmt.Errorf("%w: prerequisite %q must come earlier in the path (position %d >= %d)", core.ErrInvalidInput, prereqID, prereq.Position, module.Position)
		}
	}
	return nil
}

// computeModulePath derives the learner-facing path. Completion is pure
// runtime evidence: a module is COMPLETED when every concept it covers has
// mastery >= the module's threshold. Locking follows prerequisites only.
func computeModulePath(modules []core.CourseModule, statesByConcept map[string]core.LearnerState) []core.ModuleProgress {
	completed := map[string]bool{}
	progress := make([]core.ModuleProgress, 0, len(modules))
	for _, module := range modules {
		row := core.ModuleProgress{Module: module, ConceptsTotal: len(module.ConceptIDs)}
		var sum float64
		touched := false
		for _, conceptID := range module.ConceptIDs {
			state, ok := statesByConcept[conceptID]
			if !ok {
				continue
			}
			if state.Reps > 0 {
				touched = true
			}
			sum += state.Mastery
			if state.Mastery >= module.RequiredMastery {
				row.ConceptsMastered++
			}
		}
		if row.ConceptsTotal > 0 {
			row.AvgMastery = sum / float64(row.ConceptsTotal)
		}
		done := row.ConceptsTotal > 0 && row.ConceptsMastered == row.ConceptsTotal
		unlocked := true
		for _, prereqID := range module.PrerequisiteIDs {
			if !completed[prereqID] {
				unlocked = false
				break
			}
		}
		switch {
		case done:
			row.Status = "COMPLETED"
		case !unlocked:
			row.Status = "LOCKED"
		case touched:
			row.Status = "IN_PROGRESS"
		default:
			row.Status = "AVAILABLE"
		}
		completed[module.ID] = done
		progress = append(progress, row)
	}
	return progress
}

func sortModules(modules []core.CourseModule) {
	sort.Slice(modules, func(i, j int) bool {
		if modules[i].Position == modules[j].Position {
			return modules[i].CreatedAt.Before(modules[j].CreatedAt)
		}
		return modules[i].Position < modules[j].Position
	})
}

func applyModulePatch(module *core.CourseModule, patch core.CourseModulePatch) {
	if patch.Title != nil {
		module.Title = strings.TrimSpace(*patch.Title)
	}
	if patch.Description != nil {
		module.Description = strings.TrimSpace(*patch.Description)
	}
	if patch.Position != nil {
		module.Position = *patch.Position
	}
	if patch.ConceptIDs != nil {
		module.ConceptIDs = append([]string(nil), (*patch.ConceptIDs)...)
	}
	if patch.PrerequisiteIDs != nil {
		module.PrerequisiteIDs = append([]string(nil), (*patch.PrerequisiteIDs)...)
	}
	if patch.RequiredMastery != nil {
		module.RequiredMastery = *patch.RequiredMastery
	}
}

// ---------------------------------------------------------------------------
// Memory store
// ---------------------------------------------------------------------------

func (s *MemoryStore) CreateCourseModule(_ context.Context, module core.CourseModule, actorUserID ...string) (core.CourseModule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.syllabi[key(module.TenantID, module.SyllabusID)]; !ok {
		return core.CourseModule{}, fmt.Errorf("%w: syllabus", core.ErrNotFound)
	}
	if module.RequiredMastery == 0 {
		module.RequiredMastery = 0.85
	}
	siblings := s.listModulesLocked(module.TenantID, module.SyllabusID)
	if err := validateCourseModule(module, siblings); err != nil {
		return core.CourseModule{}, err
	}
	now := time.Now().UTC()
	module.ID = ids.New()
	module.Title = strings.TrimSpace(module.Title)
	module.CreatedAt = now
	module.UpdatedAt = now
	module.ArchivedAt = nil
	s.modules[key(module.TenantID, module.ID)] = module
	s.recordAdminAuditLocked(module.TenantID, firstActor(actorUserID), "course_module.create", "course_module", module.ID, map[string]any{"syllabus_id": module.SyllabusID}, now)
	return module, nil
}

func (s *MemoryStore) listModulesLocked(tenantID, syllabusID string) []core.CourseModule {
	modules := make([]core.CourseModule, 0)
	for _, module := range s.modules {
		if module.TenantID != tenantID || module.SyllabusID != syllabusID || module.ArchivedAt != nil {
			continue
		}
		modules = append(modules, module)
	}
	sortModules(modules)
	return modules
}

func (s *MemoryStore) ListCourseModules(_ context.Context, tenantID, syllabusID string) ([]core.CourseModule, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.syllabi[key(tenantID, syllabusID)]; !ok {
		return nil, fmt.Errorf("%w: syllabus", core.ErrNotFound)
	}
	return s.listModulesLocked(tenantID, syllabusID), nil
}

func (s *MemoryStore) UpdateCourseModule(_ context.Context, tenantID, moduleID string, patch core.CourseModulePatch, actorUserID ...string) (core.CourseModule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	module, ok := s.modules[key(tenantID, moduleID)]
	if !ok || module.ArchivedAt != nil {
		return core.CourseModule{}, fmt.Errorf("%w: course module", core.ErrNotFound)
	}
	applyModulePatch(&module, patch)
	siblings := make([]core.CourseModule, 0)
	for _, sibling := range s.listModulesLocked(tenantID, module.SyllabusID) {
		if sibling.ID != moduleID {
			siblings = append(siblings, sibling)
		}
	}
	if err := validateCourseModule(module, siblings); err != nil {
		return core.CourseModule{}, err
	}
	module.UpdatedAt = time.Now().UTC()
	s.modules[key(tenantID, moduleID)] = module
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "course_module.update", "course_module", moduleID, nil, module.UpdatedAt)
	return module, nil
}

func (s *MemoryStore) ArchiveCourseModule(_ context.Context, tenantID, moduleID string, actorUserID ...string) (core.CourseModule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	module, ok := s.modules[key(tenantID, moduleID)]
	if !ok || module.ArchivedAt != nil {
		return core.CourseModule{}, fmt.Errorf("%w: course module", core.ErrNotFound)
	}
	now := time.Now().UTC()
	module.ArchivedAt = &now
	module.UpdatedAt = now
	s.modules[key(tenantID, moduleID)] = module
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "course_module.archive", "course_module", moduleID, nil, now)
	return module, nil
}

func (s *MemoryStore) LearnerModulePath(_ context.Context, tenantID, learnerID, syllabusID string) ([]core.ModuleProgress, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.syllabi[key(tenantID, syllabusID)]; !ok {
		return nil, fmt.Errorf("%w: syllabus", core.ErrNotFound)
	}
	statesByConcept := map[string]core.LearnerState{}
	for _, state := range s.states {
		if state.TenantID == tenantID && state.LearnerID == learnerID {
			statesByConcept[state.ConceptID] = state
		}
	}
	return computeModulePath(s.listModulesLocked(tenantID, syllabusID), statesByConcept), nil
}

// ---------------------------------------------------------------------------
// Postgres store
// ---------------------------------------------------------------------------

func scanModuleRows(rows pgx.Rows) ([]core.CourseModule, error) {
	var modules []core.CourseModule
	for rows.Next() {
		module, err := scanModule(rows)
		if err != nil {
			return nil, err
		}
		modules = append(modules, module)
	}
	return modules, rows.Err()
}

type pgScanner interface {
	Scan(dest ...any) error
}

func scanModule(row pgScanner) (core.CourseModule, error) {
	var module core.CourseModule
	var conceptsRaw, prereqsRaw []byte
	if err := row.Scan(&module.TenantID, &module.ID, &module.SyllabusID, &module.Title, &module.Description, &module.Position, &conceptsRaw, &prereqsRaw, &module.RequiredMastery, &module.CreatedAt, &module.UpdatedAt, &module.ArchivedAt); err != nil {
		return core.CourseModule{}, err
	}
	module.ConceptIDs = decodeStrings(conceptsRaw)
	module.PrerequisiteIDs = decodeStrings(prereqsRaw)
	return module, nil
}

const moduleColumns = `tenant_id::text, id::text, syllabus_id::text, title, description, position, concept_ids, prerequisite_ids, required_mastery, created_at, updated_at, archived_at`

func listModulesTx(ctx context.Context, tx pgx.Tx, tenantID, syllabusID string) ([]core.CourseModule, error) {
	rows, err := tx.Query(ctx, `
		SELECT `+moduleColumns+`
		FROM course_modules
		WHERE tenant_id = $1 AND syllabus_id = $2 AND archived_at IS NULL
		ORDER BY position, created_at
	`, tenantID, syllabusID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanModuleRows(rows)
}

func syllabusExistsTx(ctx context.Context, tx pgx.Tx, tenantID, syllabusID string) error {
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM syllabi WHERE tenant_id = $1 AND id = $2)`, tenantID, syllabusID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("%w: syllabus", core.ErrNotFound)
	}
	return nil
}

func (s *PostgresStore) CreateCourseModule(ctx context.Context, module core.CourseModule, actorUserID ...string) (core.CourseModule, error) {
	if module.RequiredMastery == 0 {
		module.RequiredMastery = 0.85
	}
	err := s.withTenantTx(ctx, module.TenantID, func(tx pgx.Tx) error {
		if err := syllabusExistsTx(ctx, tx, module.TenantID, module.SyllabusID); err != nil {
			return err
		}
		siblings, err := listModulesTx(ctx, tx, module.TenantID, module.SyllabusID)
		if err != nil {
			return err
		}
		if err := validateCourseModule(module, siblings); err != nil {
			return err
		}
		now := time.Now().UTC()
		module.ID = ids.New()
		module.Title = strings.TrimSpace(module.Title)
		module.CreatedAt = now
		module.UpdatedAt = now
		module.ArchivedAt = nil
		if _, err := tx.Exec(ctx, `
			INSERT INTO course_modules (tenant_id, id, syllabus_id, title, description, position, concept_ids, prerequisite_ids, required_mastery, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		`, module.TenantID, module.ID, module.SyllabusID, module.Title, module.Description, module.Position, mustJSON(module.ConceptIDs), mustJSON(module.PrerequisiteIDs), module.RequiredMastery, module.CreatedAt, module.UpdatedAt); err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(module.TenantID, firstActor(actorUserID), "course_module.create", "course_module", module.ID, map[string]any{"syllabus_id": module.SyllabusID}, now))
	})
	if err != nil {
		return core.CourseModule{}, pgErr(err)
	}
	return module, nil
}

func (s *PostgresStore) ListCourseModules(ctx context.Context, tenantID, syllabusID string) ([]core.CourseModule, error) {
	var modules []core.CourseModule
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		if err := syllabusExistsTx(ctx, tx, tenantID, syllabusID); err != nil {
			return err
		}
		var err error
		modules, err = listModulesTx(ctx, tx, tenantID, syllabusID)
		return err
	})
	if err != nil {
		return nil, pgErr(err)
	}
	if modules == nil {
		modules = []core.CourseModule{}
	}
	return modules, nil
}

func (s *PostgresStore) UpdateCourseModule(ctx context.Context, tenantID, moduleID string, patch core.CourseModulePatch, actorUserID ...string) (core.CourseModule, error) {
	var module core.CourseModule
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `
			SELECT `+moduleColumns+`
			FROM course_modules
			WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL
		`, tenantID, moduleID)
		var err error
		module, err = scanModule(row)
		if err != nil {
			return err
		}
		applyModulePatch(&module, patch)
		all, err := listModulesTx(ctx, tx, tenantID, module.SyllabusID)
		if err != nil {
			return err
		}
		siblings := make([]core.CourseModule, 0, len(all))
		for _, sibling := range all {
			if sibling.ID != moduleID {
				siblings = append(siblings, sibling)
			}
		}
		if err := validateCourseModule(module, siblings); err != nil {
			return err
		}
		module.UpdatedAt = time.Now().UTC()
		if _, err := tx.Exec(ctx, `
			UPDATE course_modules
			SET title = $3, description = $4, position = $5, concept_ids = $6, prerequisite_ids = $7, required_mastery = $8, updated_at = $9
			WHERE tenant_id = $1 AND id = $2
		`, tenantID, moduleID, module.Title, module.Description, module.Position, mustJSON(module.ConceptIDs), mustJSON(module.PrerequisiteIDs), module.RequiredMastery, module.UpdatedAt); err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(tenantID, firstActor(actorUserID), "course_module.update", "course_module", moduleID, nil, module.UpdatedAt))
	})
	if err != nil {
		return core.CourseModule{}, pgErr(err)
	}
	return module, nil
}

func (s *PostgresStore) ArchiveCourseModule(ctx context.Context, tenantID, moduleID string, actorUserID ...string) (core.CourseModule, error) {
	var module core.CourseModule
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		now := time.Now().UTC()
		row := tx.QueryRow(ctx, `
			UPDATE course_modules
			SET archived_at = $3, updated_at = $3
			WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL
			RETURNING `+moduleColumns+`
		`, tenantID, moduleID, now)
		var err error
		module, err = scanModule(row)
		if err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(tenantID, firstActor(actorUserID), "course_module.archive", "course_module", moduleID, nil, now))
	})
	if err != nil {
		return core.CourseModule{}, pgErr(err)
	}
	return module, nil
}

func (s *PostgresStore) LearnerModulePath(ctx context.Context, tenantID, learnerID, syllabusID string) ([]core.ModuleProgress, error) {
	var path []core.ModuleProgress
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		if err := syllabusExistsTx(ctx, tx, tenantID, syllabusID); err != nil {
			return err
		}
		modules, err := listModulesTx(ctx, tx, tenantID, syllabusID)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `
			SELECT concept_id, mastery, reps
			FROM learner_states
			WHERE tenant_id = $1 AND learner_id = $2
		`, tenantID, learnerID)
		if err != nil {
			return err
		}
		defer rows.Close()
		statesByConcept := map[string]core.LearnerState{}
		for rows.Next() {
			var state core.LearnerState
			if err := rows.Scan(&state.ConceptID, &state.Mastery, &state.Reps); err != nil {
				return err
			}
			statesByConcept[state.ConceptID] = state
		}
		if err := rows.Err(); err != nil {
			return err
		}
		path = computeModulePath(modules, statesByConcept)
		return nil
	})
	if err != nil {
		return nil, pgErr(err)
	}
	if path == nil {
		path = []core.ModuleProgress{}
	}
	return path, nil
}
