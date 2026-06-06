package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"lore/internal/core"
	"lore/internal/ids"
	"lore/internal/runtime"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(ctx context.Context, databaseURL string) (*PostgresStore, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &PostgresStore{pool: pool}, nil
}

func (s *PostgresStore) Close() {
	s.pool.Close()
}

func (s *PostgresStore) CreateTenant(ctx context.Context, name, slug, parentID string) (core.Tenant, error) {
	var tenant core.Tenant
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.Tenant{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := tx.QueryRow(ctx, `
			INSERT INTO tenants (parent_id, slug, name)
			VALUES ($1, $2, $3)
			RETURNING id::text, COALESCE(parent_id::text, ''), name, slug, status, created_at
		`, nullableString(parentID), slug, name).Scan(&tenant.ID, &tenant.ParentID, &tenant.Name, &tenant.Slug, &tenant.Status, &tenant.CreatedAt); err != nil {
		return core.Tenant{}, pgErr(err)
	}
	if _, err := tx.Exec(ctx, `SELECT set_config('app.tenant_id', $1, true)`, tenant.ID); err != nil {
		return core.Tenant{}, err
	}
	if err := insertEvent(ctx, tx, newStoreEvent(tenant.ID, "TenantCreated", "tenant", tenant.ID, tenant.CreatedAt, nil)); err != nil {
		return core.Tenant{}, pgErr(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return core.Tenant{}, err
	}
	return tenant, nil
}

func (s *PostgresStore) GetTenant(ctx context.Context, tenantID string) (core.Tenant, error) {
	var tenant core.Tenant
	err := s.pool.QueryRow(ctx, `
		SELECT id::text, COALESCE(parent_id::text, ''), name, slug, status, created_at
		FROM tenants
		WHERE id = $1
	`, tenantID).Scan(&tenant.ID, &tenant.ParentID, &tenant.Name, &tenant.Slug, &tenant.Status, &tenant.CreatedAt)
	if err != nil {
		return core.Tenant{}, pgErr(err)
	}
	return tenant, nil
}

func (s *PostgresStore) CreateUser(ctx context.Context, email, name string) (core.User, error) {
	var user core.User
	err := s.pool.QueryRow(ctx, `
		INSERT INTO users (email, name)
		VALUES ($1, $2)
		RETURNING id::text, email, name, status, created_at
	`, email, name).Scan(&user.ID, &user.Email, &user.Name, &user.Status, &user.CreatedAt)
	if err != nil {
		return core.User{}, pgErr(err)
	}
	return user, nil
}

func (s *PostgresStore) AddMembership(ctx context.Context, tenantID, userID string, role core.Role) (core.Membership, error) {
	if role == "" {
		role = core.RoleLearner
	}
	if !role.Valid() {
		return core.Membership{}, fmt.Errorf("%w: unknown role %q", core.ErrInvalidInput, role)
	}
	var membership core.Membership
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		var existed bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM memberships
				WHERE tenant_id = $1 AND user_id = $2
			)
		`, tenantID, userID).Scan(&existed); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO memberships (tenant_id, user_id, role)
			VALUES ($1, $2, $3)
			ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE'
			RETURNING tenant_id::text, user_id::text, role, status, created_at
		`, tenantID, userID, string(role)).Scan(&membership.TenantID, &membership.UserID, &membership.Role, &membership.Status, &membership.CreatedAt); err != nil {
			return err
		}
		if !existed {
			var email string
			if err := tx.QueryRow(ctx, `SELECT email FROM users WHERE id = $1`, userID).Scan(&email); err != nil {
				return err
			}
			if err := insertEvent(ctx, tx, newStoreEvent(tenantID, "UserCreated", "user", userID, membership.CreatedAt, map[string]any{"user_id": userID, "email": email})); err != nil {
				return err
			}
		}
		return insertEvent(ctx, tx, newStoreEvent(tenantID, "MembershipChanged", "membership", userID, membership.CreatedAt, map[string]any{"user_id": userID, "role": string(membership.Role)}))
	})
	if err != nil {
		return core.Membership{}, pgErr(err)
	}
	return membership, nil
}

func (s *PostgresStore) ListMemberships(ctx context.Context, tenantID string) ([]core.Membership, error) {
	var memberships []core.Membership
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT tenant_id::text, user_id::text, role, status, created_at
			FROM memberships
			WHERE tenant_id = $1
			ORDER BY user_id
		`, tenantID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var membership core.Membership
			if err := rows.Scan(&membership.TenantID, &membership.UserID, &membership.Role, &membership.Status, &membership.CreatedAt); err != nil {
				return err
			}
			memberships = append(memberships, membership)
		}
		return rows.Err()
	})
	return memberships, pgErr(err)
}

func (s *PostgresStore) CreateProgram(ctx context.Context, tenantID, name string) (core.Program, error) {
	var program core.Program
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			INSERT INTO programs (tenant_id, name)
			VALUES ($1, $2)
			RETURNING tenant_id::text, id::text, name, created_at
		`, tenantID, name).Scan(&program.TenantID, &program.ID, &program.Name, &program.CreatedAt); err != nil {
			return err
		}
		return insertEvent(ctx, tx, newStoreEvent(tenantID, "ProgramCreated", "program", program.ID, program.CreatedAt, map[string]any{"name": program.Name}))
	})
	if err != nil {
		return core.Program{}, pgErr(err)
	}
	return program, nil
}

func (s *PostgresStore) CreateCohort(ctx context.Context, tenantID, programID, name string, start, end time.Time) (core.Cohort, error) {
	var cohort core.Cohort
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			INSERT INTO cohorts (tenant_id, program_id, name, start_date, end_date)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING tenant_id::text, id::text, COALESCE(program_id::text, ''), name, COALESCE(start_date, '0001-01-01'::date), COALESCE(end_date, '0001-01-01'::date), created_at
		`, tenantID, nullableString(programID), name, nullableTime(start), nullableTime(end)).Scan(&cohort.TenantID, &cohort.ID, &cohort.ProgramID, &cohort.Name, &cohort.StartDate, &cohort.EndDate, &cohort.CreatedAt); err != nil {
			return err
		}
		return insertEvent(ctx, tx, newStoreEvent(tenantID, "CohortCreated", "cohort", cohort.ID, cohort.CreatedAt, map[string]any{"program_id": programID, "name": cohort.Name}))
	})
	if err != nil {
		return core.Cohort{}, pgErr(err)
	}
	return cohort, nil
}

func (s *PostgresStore) EnrollLearner(ctx context.Context, tenantID, cohortID, learnerID string) (core.CohortEnrollment, error) {
	var enrollment core.CohortEnrollment
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			INSERT INTO cohort_enrollments (tenant_id, cohort_id, learner_id)
			VALUES ($1, $2, $3)
			ON CONFLICT (tenant_id, cohort_id, learner_id) DO UPDATE SET status = 'ACTIVE'
			RETURNING tenant_id::text, cohort_id::text, learner_id::text, status, created_at
		`, tenantID, cohortID, learnerID).Scan(&enrollment.TenantID, &enrollment.CohortID, &enrollment.LearnerID, &enrollment.Status, &enrollment.CreatedAt); err != nil {
			return err
		}
		return insertEvent(ctx, tx, newStoreEvent(tenantID, "LearnerEnrolled", "cohort_enrollment", cohortID, enrollment.CreatedAt, map[string]any{"cohort_id": cohortID, "learner_id": learnerID}))
	})
	if err != nil {
		return core.CohortEnrollment{}, pgErr(err)
	}
	return enrollment, nil
}

func (s *PostgresStore) CreateSyllabus(ctx context.Context, tenantID, title, description string, objectives, outcomes map[string]any) (core.Syllabus, error) {
	var syllabus core.Syllabus
	var objectivesRaw, outcomesRaw []byte
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			INSERT INTO syllabi (tenant_id, title, description, objectives_json, outcomes_json)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING tenant_id::text, id::text, title, description, objectives_json, outcomes_json, created_at
		`, tenantID, title, description, mustJSON(objectives), mustJSON(outcomes)).Scan(
			&syllabus.TenantID, &syllabus.ID, &syllabus.Title, &syllabus.Description, &objectivesRaw, &outcomesRaw, &syllabus.CreatedAt); err != nil {
			return err
		}
		return insertEvent(ctx, tx, newStoreEvent(tenantID, "SyllabusCreated", "syllabus", syllabus.ID, syllabus.CreatedAt, map[string]any{"title": syllabus.Title}))
	})
	if err != nil {
		return core.Syllabus{}, pgErr(err)
	}
	syllabus.Objectives = decodeMap(objectivesRaw)
	syllabus.Outcomes = decodeMap(outcomesRaw)
	return syllabus, nil
}

func (s *PostgresStore) BindSyllabus(ctx context.Context, tenantID, syllabusID, targetType, targetID, adaptationMode string) (core.SyllabusBinding, error) {
	var binding core.SyllabusBinding
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			INSERT INTO syllabus_bindings (tenant_id, syllabus_id, target_type, target_id, adaptation_mode)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING tenant_id::text, id::text, syllabus_id::text, target_type, target_id::text, adaptation_mode, created_at
		`, tenantID, syllabusID, targetType, targetID, adaptationMode).Scan(
			&binding.TenantID, &binding.ID, &binding.SyllabusID, &binding.TargetType, &binding.TargetID, &binding.AdaptationMode, &binding.CreatedAt); err != nil {
			return err
		}
		return insertEvent(ctx, tx, newStoreEvent(tenantID, "SyllabusBound", "syllabus_binding", binding.ID, binding.CreatedAt, map[string]any{"syllabus_id": syllabusID, "target_type": targetType, "target_id": targetID}))
	})
	if err != nil {
		return core.SyllabusBinding{}, pgErr(err)
	}
	return binding, nil
}

func (s *PostgresStore) CreateDomain(ctx context.Context, tenantID, ownerID, name, description, source string, drafts []core.ConceptDraft, depDrafts []core.DependencyDraft) (core.DomainGraph, error) {
	if source == "" {
		source = "TRAINER"
	}
	now := time.Now().UTC()
	domain := core.Domain{
		TenantID:     tenantID,
		ID:           ids.New(),
		OwnerID:      ownerID,
		Name:         name,
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
	err = s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO domains (tenant_id, id, owner_id, name, description, source, graph_version, status, phase, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		`, tenantID, domain.ID, nullableString(ownerID), domain.Name, domain.Description, domain.Source, domain.GraphVersion, domain.Status, string(domain.Phase), domain.CreatedAt, domain.UpdatedAt); err != nil {
			return err
		}
		for _, concept := range graph.Concepts {
			if _, err := tx.Exec(ctx, `
				INSERT INTO concepts (tenant_id, id, domain_id, name, description, difficulty, created_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
			`, tenantID, concept.ID, domain.ID, concept.Name, concept.Description, concept.Difficulty, concept.CreatedAt); err != nil {
				return err
			}
		}
		for _, dep := range graph.Dependencies {
			if _, err := tx.Exec(ctx, `
				INSERT INTO concept_dependencies (tenant_id, domain_id, parent_concept_id, child_concept_id)
				VALUES ($1, $2, $3, $4)
			`, tenantID, domain.ID, dep.ParentConceptID, dep.ChildConceptID); err != nil {
				return err
			}
		}
		if err := insertEvent(ctx, tx, newStoreEvent(tenantID, "DomainCreated", "domain", domain.ID, now, map[string]any{"name": domain.Name})); err != nil {
			return err
		}
		return insertEvent(ctx, tx, newStoreEvent(tenantID, "ConceptGraphPublished", "domain", domain.ID, now, map[string]any{"graph_version": domain.GraphVersion}))
	})
	if err != nil {
		return core.DomainGraph{}, pgErr(err)
	}
	return graph, nil
}

func (s *PostgresStore) ReplaceDomainGraph(ctx context.Context, tenantID, domainID string, drafts []core.ConceptDraft, depDrafts []core.DependencyDraft) (core.DomainGraph, error) {
	var graph core.DomainGraph
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		var domain core.Domain
		if err := tx.QueryRow(ctx, `
			UPDATE domains
			SET graph_version = graph_version + 1, updated_at = now()
			WHERE tenant_id = $1 AND id = $2
			RETURNING tenant_id::text, id::text, COALESCE(owner_id::text, ''), name, description, source, graph_version, status, phase, created_at, updated_at
		`, tenantID, domainID).Scan(&domain.TenantID, &domain.ID, &domain.OwnerID, &domain.Name, &domain.Description, &domain.Source, &domain.GraphVersion, &domain.Status, &domain.Phase, &domain.CreatedAt, &domain.UpdatedAt); err != nil {
			return err
		}
		nextGraph, err := buildGraph(domain, drafts, depDrafts)
		if err != nil {
			return err
		}
		if err := runtime.ValidateGraph(nextGraph.Concepts, nextGraph.Dependencies); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM concept_dependencies WHERE tenant_id = $1 AND domain_id = $2`, tenantID, domainID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM concepts WHERE tenant_id = $1 AND domain_id = $2`, tenantID, domainID); err != nil {
			return err
		}
		for _, concept := range nextGraph.Concepts {
			if _, err := tx.Exec(ctx, `
				INSERT INTO concepts (tenant_id, id, domain_id, name, description, difficulty, created_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
			`, tenantID, concept.ID, domainID, concept.Name, concept.Description, concept.Difficulty, concept.CreatedAt); err != nil {
				return err
			}
		}
		for _, dep := range nextGraph.Dependencies {
			if _, err := tx.Exec(ctx, `
				INSERT INTO concept_dependencies (tenant_id, domain_id, parent_concept_id, child_concept_id)
				VALUES ($1, $2, $3, $4)
			`, tenantID, domainID, dep.ParentConceptID, dep.ChildConceptID); err != nil {
				return err
			}
		}
		graph = nextGraph
		return insertEvent(ctx, tx, newStoreEvent(tenantID, "ConceptGraphPublished", "domain", domainID, domain.UpdatedAt, map[string]any{"graph_version": domain.GraphVersion}))
	})
	return graph, pgErr(err)
}

func (s *PostgresStore) GetDomainGraph(ctx context.Context, tenantID, domainID string) (core.DomainGraph, error) {
	var graph core.DomainGraph
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		var domain core.Domain
		if err := tx.QueryRow(ctx, `
			SELECT tenant_id::text, id::text, COALESCE(owner_id::text, ''), name, description, source, graph_version, status, phase, created_at, updated_at
			FROM domains
			WHERE tenant_id = $1 AND id = $2
		`, tenantID, domainID).Scan(&domain.TenantID, &domain.ID, &domain.OwnerID, &domain.Name, &domain.Description, &domain.Source, &domain.GraphVersion, &domain.Status, &domain.Phase, &domain.CreatedAt, &domain.UpdatedAt); err != nil {
			return err
		}
		graph.Domain = domain
		rows, err := tx.Query(ctx, `
			SELECT tenant_id::text, id::text, domain_id::text, name, description, difficulty, created_at
			FROM concepts
			WHERE tenant_id = $1 AND domain_id = $2
			ORDER BY name, id
		`, tenantID, domainID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var concept core.Concept
			if err := rows.Scan(&concept.TenantID, &concept.ID, &concept.DomainID, &concept.Name, &concept.Description, &concept.Difficulty, &concept.CreatedAt); err != nil {
				return err
			}
			graph.Concepts = append(graph.Concepts, concept)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		rows, err = tx.Query(ctx, `
			SELECT tenant_id::text, domain_id::text, parent_concept_id::text, child_concept_id::text
			FROM concept_dependencies
			WHERE tenant_id = $1 AND domain_id = $2
			ORDER BY parent_concept_id, child_concept_id
		`, tenantID, domainID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var dep core.Dependency
			if err := rows.Scan(&dep.TenantID, &dep.DomainID, &dep.ParentConceptID, &dep.ChildConceptID); err != nil {
				return err
			}
			graph.Dependencies = append(graph.Dependencies, dep)
		}
		return rows.Err()
	})
	return graph, pgErr(err)
}

func (s *PostgresStore) GetLearnerStates(ctx context.Context, tenantID, learnerID, domainID string) ([]core.LearnerState, error) {
	return s.queryLearnerStates(ctx, tenantID, `WHERE tenant_id = $1 AND learner_id = $2 AND domain_id = $3 ORDER BY concept_id`, tenantID, learnerID, domainID)
}

func (s *PostgresStore) ListLearnerState(ctx context.Context, tenantID, learnerID string) ([]core.LearnerState, error) {
	return s.queryLearnerStates(ctx, tenantID, `WHERE tenant_id = $1 AND learner_id = $2 ORDER BY domain_id, concept_id`, tenantID, learnerID)
}

func (s *PostgresStore) ListActiveMisconceptions(ctx context.Context, tenantID, learnerID, domainID string) ([]core.Misconception, error) {
	var misconceptions []core.Misconception
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT m.tenant_id::text, m.id::text, m.learner_id::text, m.concept_id::text, m.description, m.severity, m.status, m.created_at
			FROM misconceptions m
			JOIN concepts c ON c.tenant_id = m.tenant_id AND c.id = m.concept_id
			WHERE m.tenant_id = $1 AND m.learner_id = $2 AND c.domain_id = $3 AND m.status = 'ACTIVE'
			ORDER BY m.severity DESC, m.created_at, m.id
		`, tenantID, learnerID, domainID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var misconception core.Misconception
			if err := rows.Scan(&misconception.TenantID, &misconception.ID, &misconception.LearnerID, &misconception.ConceptID, &misconception.Description, &misconception.Severity, &misconception.Status, &misconception.CreatedAt); err != nil {
				return err
			}
			misconceptions = append(misconceptions, misconception)
		}
		return rows.Err()
	})
	return misconceptions, pgErr(err)
}

func (s *PostgresStore) ListDueReviews(ctx context.Context, tenantID, learnerID string, now time.Time) ([]core.ReviewCard, error) {
	var cards []core.ReviewCard
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT tenant_id::text, learner_id::text, domain_id::text, concept_id::text, due_at, stability, difficulty, reps, lapses, state
			FROM review_cards
			WHERE tenant_id = $1 AND learner_id = $2 AND due_at <= $3 AND state <> 'new'
			ORDER BY due_at, concept_id
		`, tenantID, learnerID, now)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var card core.ReviewCard
			if err := rows.Scan(&card.TenantID, &card.LearnerID, &card.DomainID, &card.ConceptID, &card.DueAt, &card.Stability, &card.Difficulty, &card.Reps, &card.Lapses, &card.State); err != nil {
				return err
			}
			card.Retention = runtime.Retention(card.Stability, &card.DueAt, now)
			cards = append(cards, card)
		}
		return rows.Err()
	})
	return cards, pgErr(err)
}

func (s *PostgresStore) GetRecentInteractions(ctx context.Context, tenantID, learnerID, domainID string, limit int) ([]core.Interaction, error) {
	var interactions []core.Interaction
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT tenant_id::text, id::text, learner_id::text, activity_id::text, domain_id::text, concept_id::text, success, score, COALESCE(error_type, ''), payload_json, created_at
			FROM interactions
			WHERE tenant_id = $1 AND learner_id = $2 AND domain_id = $3
			ORDER BY created_at DESC
			LIMIT $4
		`, tenantID, learnerID, domainID, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			interaction, err := scanInteraction(rows)
			if err != nil {
				return err
			}
			interactions = append(interactions, interaction)
		}
		return rows.Err()
	})
	return interactions, pgErr(err)
}

func (s *PostgresStore) SavePlannedActivity(ctx context.Context, activity core.Activity, instruction core.TutorInstruction, snapshot core.PedagogicalSnapshot, events []core.Event) error {
	return pgErr(s.withTenantTx(ctx, activity.TenantID, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO activities (tenant_id, id, learner_id, domain_id, concept_id, activity_type, difficulty, status, instruction_id, audit_rationale, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		`, activity.TenantID, activity.ID, activity.LearnerID, activity.DomainID, activity.ConceptID, string(activity.ActivityType), activity.DifficultyTarget, string(activity.Status), instruction.ID, activity.AuditRationale, activity.CreatedAt); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO tutor_instructions (tenant_id, id, activity_id, learner_id, domain_id, concept_id, activity_type, difficulty, constraints_json, allowed_variants_json, context_json, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		`, instruction.TenantID, instruction.ID, instruction.ActivityID, instruction.LearnerID, instruction.DomainID, nullableString(instruction.ConceptID), string(instruction.ActivityType), instruction.DifficultyTarget, mustJSON(instruction.Constraints), mustJSON(instruction.AllowedVariants), mustJSON(instruction.Context), instruction.CreatedAt); err != nil {
			return err
		}
		if err := insertSnapshot(ctx, tx, snapshot); err != nil {
			return err
		}
		for _, event := range events {
			if err := insertEvent(ctx, tx, event); err != nil {
				return err
			}
		}
		return nil
	}))
}

func (s *PostgresStore) GetActivity(ctx context.Context, tenantID, activityID string) (core.Activity, core.TutorInstruction, error) {
	var activity core.Activity
	var instruction core.TutorInstruction
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			SELECT tenant_id::text, id::text, learner_id::text, domain_id::text, concept_id::text, activity_type, difficulty, status, instruction_id::text, audit_rationale, created_at, started_at, completed_at
			FROM activities
			WHERE tenant_id = $1 AND id = $2
		`, tenantID, activityID).Scan(&activity.TenantID, &activity.ID, &activity.LearnerID, &activity.DomainID, &activity.ConceptID, &activity.ActivityType, &activity.DifficultyTarget, &activity.Status, &activity.InstructionID, &activity.AuditRationale, &activity.CreatedAt, &activity.StartedAt, &activity.CompletedAt); err != nil {
			return err
		}
		var constraintsRaw, variantsRaw, contextRaw []byte
		if err := tx.QueryRow(ctx, `
			SELECT tenant_id::text, id::text, activity_id::text, learner_id::text, domain_id::text, COALESCE(concept_id::text, ''), activity_type, difficulty, constraints_json, allowed_variants_json, context_json, created_at
			FROM tutor_instructions
			WHERE tenant_id = $1 AND id = $2
		`, tenantID, activity.InstructionID).Scan(&instruction.TenantID, &instruction.ID, &instruction.ActivityID, &instruction.LearnerID, &instruction.DomainID, &instruction.ConceptID, &instruction.ActivityType, &instruction.DifficultyTarget, &constraintsRaw, &variantsRaw, &contextRaw, &instruction.CreatedAt); err != nil {
			return err
		}
		instruction.Constraints = decodeStrings(constraintsRaw)
		instruction.AllowedVariants = decodeStrings(variantsRaw)
		instruction.Context = decodeMap(contextRaw)
		return nil
	})
	if err != nil {
		return core.Activity{}, core.TutorInstruction{}, pgErr(err)
	}
	return activity, instruction, nil
}

func (s *PostgresStore) StartActivity(ctx context.Context, tenantID, activityID string) (core.Activity, error) {
	var activity core.Activity
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			UPDATE activities
			SET status = 'STARTED', started_at = now()
			WHERE tenant_id = $1 AND id = $2
			RETURNING tenant_id::text, id::text, learner_id::text, domain_id::text, concept_id::text, activity_type, difficulty, status, instruction_id::text, audit_rationale, created_at, started_at, completed_at
		`, tenantID, activityID).Scan(&activity.TenantID, &activity.ID, &activity.LearnerID, &activity.DomainID, &activity.ConceptID, &activity.ActivityType, &activity.DifficultyTarget, &activity.Status, &activity.InstructionID, &activity.AuditRationale, &activity.CreatedAt, &activity.StartedAt, &activity.CompletedAt); err != nil {
			return err
		}
		occurredAt := time.Now().UTC()
		if activity.StartedAt != nil {
			occurredAt = *activity.StartedAt
		}
		return insertEvent(ctx, tx, newStoreEvent(tenantID, "ActivityStarted", "activity", activityID, occurredAt, map[string]any{"learner_id": activity.LearnerID}))
	})
	if err != nil {
		return core.Activity{}, pgErr(err)
	}
	return activity, nil
}

func (s *PostgresStore) SaveInteractionDelta(ctx context.Context, delta core.StateDelta, activity core.Activity) error {
	return pgErr(s.withTenantTx(ctx, activity.TenantID, func(tx pgx.Tx) error {
		return saveInteractionDeltaTx(ctx, tx, delta, activity)
	}))
}

func (s *PostgresStore) SaveInteractionDeltaIdempotent(ctx context.Context, delta core.StateDelta, activity core.Activity, record core.IdempotencyRecord) error {
	if record.TenantID == "" || record.Key == "" || record.StatusCode <= 0 || len(record.Response) == 0 {
		return fmt.Errorf("%w: invalid idempotency record", core.ErrInvalidInput)
	}
	return pgErr(s.withTenantTx(ctx, activity.TenantID, func(tx pgx.Tx) error {
		if record.TenantID != activity.TenantID {
			return fmt.Errorf("%w: idempotency tenant", core.ErrTenantMismatch)
		}
		if record.CreatedAt.IsZero() {
			record.CreatedAt = time.Now().UTC()
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO idempotency_records (tenant_id, key, status_code, response_json, created_at)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (tenant_id, key) DO NOTHING
		`, record.TenantID, record.Key, record.StatusCode, record.Response, record.CreatedAt)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("%w: idempotency record", core.ErrConflict)
		}
		return saveInteractionDeltaTx(ctx, tx, delta, activity)
	}))
}

func saveInteractionDeltaTx(ctx context.Context, tx pgx.Tx, delta core.StateDelta, activity core.Activity) error {
	if delta.Interaction.TenantID != activity.TenantID || delta.After.TenantID != activity.TenantID || delta.Snapshot.TenantID != activity.TenantID {
		return fmt.Errorf("%w: interaction delta", core.ErrTenantMismatch)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE activities
		SET status = $3, completed_at = $4
		WHERE tenant_id = $1 AND id = $2
	`, activity.TenantID, activity.ID, string(activity.Status), activity.CompletedAt); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO interactions (tenant_id, id, learner_id, activity_id, domain_id, concept_id, success, score, error_type, payload_json, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, delta.Interaction.TenantID, delta.Interaction.ID, delta.Interaction.LearnerID, delta.Interaction.ActivityID, delta.Interaction.DomainID, delta.Interaction.ConceptID, delta.Interaction.Success, delta.Interaction.Score, nullableString(delta.Interaction.ErrorType), mustJSON(delta.Interaction.Payload), delta.Interaction.CreatedAt); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO evaluations (tenant_id, id, interaction_id, score, feedback, rubric_json, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, delta.Evaluation.TenantID, delta.Evaluation.ID, delta.Evaluation.InteractionID, delta.Evaluation.Score, delta.Evaluation.Feedback, mustJSON(delta.Evaluation.Rubric), delta.Evaluation.CreatedAt); err != nil {
		return err
	}
	if err := upsertLearnerState(ctx, tx, delta.After); err != nil {
		return err
	}
	if err := upsertReviewCard(ctx, tx, delta.After); err != nil {
		return err
	}
	if err := saveMisconceptionChanges(ctx, tx, delta.Misconceptions); err != nil {
		return err
	}
	if err := insertSnapshot(ctx, tx, delta.Snapshot); err != nil {
		return err
	}
	for _, event := range delta.Events {
		if err := insertEvent(ctx, tx, event); err != nil {
			return err
		}
	}
	return nil
}

func (s *PostgresStore) GetInstruction(ctx context.Context, tenantID, instructionID string) (core.TutorInstruction, error) {
	var instruction core.TutorInstruction
	var constraintsRaw, variantsRaw, contextRaw []byte
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT tenant_id::text, id::text, activity_id::text, learner_id::text, domain_id::text, COALESCE(concept_id::text, ''), activity_type, difficulty, constraints_json, allowed_variants_json, context_json, created_at
			FROM tutor_instructions
			WHERE tenant_id = $1 AND id = $2
		`, tenantID, instructionID).Scan(&instruction.TenantID, &instruction.ID, &instruction.ActivityID, &instruction.LearnerID, &instruction.DomainID, &instruction.ConceptID, &instruction.ActivityType, &instruction.DifficultyTarget, &constraintsRaw, &variantsRaw, &contextRaw, &instruction.CreatedAt)
	})
	if err != nil {
		return core.TutorInstruction{}, pgErr(err)
	}
	instruction.Constraints = decodeStrings(constraintsRaw)
	instruction.AllowedVariants = decodeStrings(variantsRaw)
	instruction.Context = decodeMap(contextRaw)
	return instruction, nil
}

func (s *PostgresStore) SaveGeneratedContent(ctx context.Context, content core.GeneratedContent) error {
	return pgErr(s.withTenantTx(ctx, content.TenantID, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO generated_contents (tenant_id, id, instruction_id, provider, model, content, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, content.TenantID, content.ID, content.InstructionID, content.Provider, content.Model, content.Content, content.CreatedAt); err != nil {
			return err
		}
		return insertEvent(ctx, tx, newStoreEvent(content.TenantID, "GeneratedContentCreated", "generated_content", content.ID, content.CreatedAt, map[string]any{"instruction_id": content.InstructionID}))
	}))
}

func (s *PostgresStore) ListGeneratedContent(ctx context.Context, tenantID, instructionID string) ([]core.GeneratedContent, error) {
	var contents []core.GeneratedContent
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		sql := `
			SELECT tenant_id::text, id::text, instruction_id::text, provider, model, content, created_at
			FROM generated_contents
			WHERE tenant_id = $1`
		args := []any{tenantID}
		if instructionID != "" {
			sql += ` AND instruction_id = $2`
			args = append(args, instructionID)
		}
		sql += ` ORDER BY created_at DESC, id`
		rows, err := tx.Query(ctx, sql, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var content core.GeneratedContent
			if err := rows.Scan(&content.TenantID, &content.ID, &content.InstructionID, &content.Provider, &content.Model, &content.Content, &content.CreatedAt); err != nil {
				return err
			}
			contents = append(contents, content)
		}
		return rows.Err()
	})
	return contents, pgErr(err)
}

func (s *PostgresStore) GetGeneratedContent(ctx context.Context, tenantID, contentID string) (core.GeneratedContent, error) {
	var content core.GeneratedContent
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT tenant_id::text, id::text, instruction_id::text, provider, model, content, created_at
			FROM generated_contents
			WHERE tenant_id = $1 AND id = $2
		`, tenantID, contentID).Scan(&content.TenantID, &content.ID, &content.InstructionID, &content.Provider, &content.Model, &content.Content, &content.CreatedAt)
	})
	return content, pgErr(err)
}

func (s *PostgresStore) GetLLMConfiguration(ctx context.Context, tenantID, scopeType, scopeID string) (core.LLMConfiguration, error) {
	scopeType, scopeID, err := normalizeLLMScope(scopeType, scopeID)
	if err != nil {
		return core.LLMConfiguration{}, err
	}
	var config core.LLMConfiguration
	err = s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT tenant_id::text, scope_type, scope_id, provider, model, base_url, api_key, temperature, max_tokens, created_at, updated_at
			FROM llm_configurations
			WHERE tenant_id = $1 AND scope_type = $2 AND scope_id = $3
		`, tenantID, scopeType, scopeID).Scan(&config.TenantID, &config.ScopeType, &config.ScopeID, &config.Provider, &config.Model, &config.BaseURL, &config.APIKey, &config.Temperature, &config.MaxTokens, &config.CreatedAt, &config.UpdatedAt)
	})
	if config.APIKey != "" {
		config.APIKeyConfigured = true
	}
	return config, pgErr(err)
}

func (s *PostgresStore) SaveLLMConfiguration(ctx context.Context, config core.LLMConfiguration) (core.LLMConfiguration, error) {
	scopeType, scopeID, err := normalizeLLMScope(config.ScopeType, config.ScopeID)
	if err != nil {
		return core.LLMConfiguration{}, err
	}
	config.ScopeType = scopeType
	config.ScopeID = scopeID
	var saved core.LLMConfiguration
	err = s.withTenantTx(ctx, config.TenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO llm_configurations (tenant_id, scope_type, scope_id, provider, model, base_url, api_key, temperature, max_tokens)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			ON CONFLICT (tenant_id, scope_type, scope_id) DO UPDATE SET
				provider = EXCLUDED.provider,
				model = EXCLUDED.model,
				base_url = EXCLUDED.base_url,
				api_key = EXCLUDED.api_key,
				temperature = EXCLUDED.temperature,
				max_tokens = EXCLUDED.max_tokens,
				updated_at = now()
			RETURNING tenant_id::text, scope_type, scope_id, provider, model, base_url, api_key, temperature, max_tokens, created_at, updated_at
		`, config.TenantID, config.ScopeType, config.ScopeID, config.Provider, config.Model, config.BaseURL, config.APIKey, config.Temperature, config.MaxTokens).Scan(&saved.TenantID, &saved.ScopeType, &saved.ScopeID, &saved.Provider, &saved.Model, &saved.BaseURL, &saved.APIKey, &saved.Temperature, &saved.MaxTokens, &saved.CreatedAt, &saved.UpdatedAt)
	})
	if saved.APIKey != "" {
		saved.APIKeyConfigured = true
	}
	return saved, pgErr(err)
}

func (s *PostgresStore) ListSnapshots(ctx context.Context, tenantID, learnerID string) ([]core.PedagogicalSnapshot, error) {
	var snapshots []core.PedagogicalSnapshot
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT tenant_id::text, id::text, COALESCE(interaction_id::text, ''), COALESCE(activity_id::text, ''), learner_id::text, domain_id::text, COALESCE(concept_id::text, ''), before_json, observation_json, after_json, decision_json, created_at
			FROM pedagogical_snapshots
			WHERE tenant_id = $1 AND learner_id = $2
			ORDER BY created_at DESC
		`, tenantID, learnerID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			snapshot, err := scanSnapshot(rows)
			if err != nil {
				return err
			}
			snapshots = append(snapshots, snapshot)
		}
		return rows.Err()
	})
	return snapshots, pgErr(err)
}

func (s *PostgresStore) ListEvents(ctx context.Context, tenantID string, unpublishedOnly bool) ([]core.Event, error) {
	var events []core.Event
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		sql := `
			SELECT tenant_id::text, id::text, schema_version, actor_user_id, correlation_id, causation_id, event_type, aggregate_type, aggregate_id::text, payload_json, occurred_at, published_at
			FROM event_outbox
			WHERE tenant_id = $1`
		if unpublishedOnly {
			sql += ` AND published_at IS NULL`
		}
		sql += ` ORDER BY occurred_at, id`
		rows, err := tx.Query(ctx, sql, tenantID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			event, err := scanEvent(rows)
			if err != nil {
				return err
			}
			events = append(events, event)
		}
		return rows.Err()
	})
	return events, pgErr(err)
}

func (s *PostgresStore) ListUnpublishedEvents(ctx context.Context, limit int) ([]core.Event, error) {
	rows, err := s.pool.Query(ctx, `SELECT id::text FROM tenants ORDER BY created_at, id`)
	if err != nil {
		return nil, pgErr(err)
	}
	defer rows.Close()
	var tenantIDs []string
	for rows.Next() {
		var tenantID string
		if err := rows.Scan(&tenantID); err != nil {
			return nil, err
		}
		tenantIDs = append(tenantIDs, tenantID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var result []core.Event
	for _, tenantID := range tenantIDs {
		events, err := s.ListEvents(ctx, tenantID, true)
		if err != nil {
			return nil, err
		}
		for _, event := range events {
			result = append(result, event)
			if limit > 0 && len(result) >= limit {
				return result, nil
			}
		}
	}
	return result, nil
}

func (s *PostgresStore) MarkEventPublished(ctx context.Context, tenantID, eventID string, now time.Time) (core.Event, error) {
	var event core.Event
	var payloadRaw []byte
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			UPDATE event_outbox
			SET published_at = $3
			WHERE tenant_id = $1 AND id = $2
			RETURNING tenant_id::text, id::text, schema_version, actor_user_id, correlation_id, causation_id, event_type, aggregate_type, aggregate_id::text, payload_json, occurred_at, published_at
		`, tenantID, eventID, now).Scan(&event.TenantID, &event.ID, &event.SchemaVersion, &event.ActorUserID, &event.CorrelationID, &event.CausationID, &event.EventType, &event.AggregateType, &event.AggregateID, &payloadRaw, &event.OccurredAt, &event.PublishedAt)
	})
	if err != nil {
		return core.Event{}, pgErr(err)
	}
	event.Payload = decodeMap(payloadRaw)
	return event, nil
}

func (s *PostgresStore) ListAlerts(ctx context.Context, tenantID string, now time.Time) ([]core.Alert, error) {
	states, err := s.queryLearnerStates(ctx, tenantID, `WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT 500`, tenantID)
	if err != nil {
		return nil, err
	}
	var recent []core.Interaction
	err = s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT tenant_id::text, id::text, learner_id::text, activity_id::text, domain_id::text, concept_id::text, success, score, COALESCE(error_type, ''), payload_json, created_at
			FROM interactions
			WHERE tenant_id = $1
			ORDER BY created_at DESC
			LIMIT 50
		`, tenantID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			interaction, err := scanInteraction(rows)
			if err != nil {
				return err
			}
			recent = append(recent, interaction)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, pgErr(err)
	}
	computed := runtime.ComputeAlerts(states, recent, now)
	return s.syncAndListAlerts(ctx, tenantID, computed, now)
}

func (s *PostgresStore) syncAndListAlerts(ctx context.Context, tenantID string, computed []core.Alert, now time.Time) ([]core.Alert, error) {
	var alerts []core.Alert
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		for _, alert := range computed {
			if err := upsertAlertTx(ctx, tx, alert, now); err != nil {
				return err
			}
		}
		rows, err := tx.Query(ctx, `
			SELECT tenant_id::text, id::text, learner_id::text, COALESCE(concept_id::text, ''), alert_type, severity, status, payload_json, recommended_action, created_at, updated_at
			FROM alerts
			WHERE tenant_id = $1 AND status <> 'RESOLVED'
		`, tenantID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			alert, err := scanAlert(rows)
			if err != nil {
				return err
			}
			alerts = append(alerts, alert)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, pgErr(err)
	}
	sortAlerts(alerts)
	return alerts, nil
}

func (s *PostgresStore) UpdateAlertStatus(ctx context.Context, tenantID, alertID, status string, now time.Time) (core.Alert, error) {
	var alert core.Alert
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		var payloadRaw []byte
		if err := tx.QueryRow(ctx, `
			UPDATE alerts
			SET status = $3, updated_at = $4
			WHERE tenant_id = $1 AND id = $2
			RETURNING tenant_id::text, id::text, learner_id::text, COALESCE(concept_id::text, ''), alert_type, severity, status, payload_json, recommended_action, created_at, updated_at
		`, tenantID, alertID, status, now).Scan(&alert.TenantID, &alert.ID, &alert.LearnerID, &alert.ConceptID, &alert.AlertType, &alert.Severity, &alert.Status, &payloadRaw, &alert.RecommendedAction, &alert.CreatedAt, &alert.UpdatedAt); err != nil {
			return err
		}
		alert.Payload = decodeMap(payloadRaw)
		if status == "RESOLVED" {
			return insertEvent(ctx, tx, newStoreEvent(tenantID, "AlertResolved", "alert", alertID, now, map[string]any{"alert_type": alert.AlertType, "learner_id": alert.LearnerID, "concept_id": alert.ConceptID}))
		}
		return nil
	})
	if err != nil {
		return core.Alert{}, pgErr(err)
	}
	return alert, nil
}

func (s *PostgresStore) CohortAnalytics(ctx context.Context, tenantID, cohortID string) (map[string]any, error) {
	var learnerCount, stateCount, activeMisconceptions int
	var avgMastery *float64
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			WITH learners AS (
				SELECT learner_id
				FROM cohort_enrollments
				WHERE tenant_id = $1 AND cohort_id = $2 AND status = 'ACTIVE'
			)
			SELECT
				(SELECT count(*) FROM learners)::int,
				count(ls.*)::int,
				avg(ls.mastery),
				(
					SELECT count(*)
					FROM misconceptions m
					JOIN learners l ON l.learner_id = m.learner_id
					WHERE m.tenant_id = $1 AND m.status = 'ACTIVE'
				)::int
			FROM learners l
			LEFT JOIN learner_states ls ON ls.tenant_id = $1 AND ls.learner_id = l.learner_id
		`, tenantID, cohortID).Scan(&learnerCount, &stateCount, &avgMastery, &activeMisconceptions)
	})
	if err != nil {
		return nil, pgErr(err)
	}
	avg := 0.0
	if avgMastery != nil {
		avg = *avgMastery
	}
	return map[string]any{
		"tenant_id":             tenantID,
		"cohort_id":             cohortID,
		"learner_count":         learnerCount,
		"state_count":           stateCount,
		"average_mastery":       avg,
		"active_misconceptions": activeMisconceptions,
	}, nil
}

func (s *PostgresStore) GetIdempotencyRecord(ctx context.Context, tenantID, idempotencyKey string) (core.IdempotencyRecord, error) {
	var record core.IdempotencyRecord
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		var responseRaw []byte
		if err := tx.QueryRow(ctx, `
			SELECT tenant_id::text, key, status_code, response_json, created_at
			FROM idempotency_records
			WHERE tenant_id = $1 AND key = $2
		`, tenantID, idempotencyKey).Scan(&record.TenantID, &record.Key, &record.StatusCode, &responseRaw, &record.CreatedAt); err != nil {
			return err
		}
		record.Response = responseRaw
		return nil
	})
	return record, pgErr(err)
}

func (s *PostgresStore) SaveIdempotencyRecord(ctx context.Context, record core.IdempotencyRecord) error {
	if record.StatusCode <= 0 {
		record.StatusCode = 200
	}
	if record.CreatedAt.IsZero() {
		record.CreatedAt = time.Now().UTC()
	}
	return pgErr(s.withTenantTx(ctx, record.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO idempotency_records (tenant_id, key, status_code, response_json, created_at)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (tenant_id, key) DO NOTHING
		`, record.TenantID, record.Key, record.StatusCode, record.Response, record.CreatedAt)
		return err
	}))
}

func (s *PostgresStore) queryLearnerStates(ctx context.Context, tenantID, where string, args ...any) ([]core.LearnerState, error) {
	var states []core.LearnerState
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT tenant_id::text, learner_id::text, domain_id::text, concept_id::text, mastery, retention, confidence, ability,
			       p_learn, p_forget, p_slip, p_guess, stability, difficulty, reps, lapses, card_state, due_at, last_interaction_at, updated_at
			FROM learner_states `+where, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var state core.LearnerState
			if err := rows.Scan(&state.TenantID, &state.LearnerID, &state.DomainID, &state.ConceptID, &state.Mastery, &state.Retention, &state.Confidence, &state.Ability, &state.PLearn, &state.PForget, &state.PSlip, &state.PGuess, &state.Stability, &state.Difficulty, &state.Reps, &state.Lapses, &state.CardState, &state.DueAt, &state.LastInteractionAt, &state.UpdatedAt); err != nil {
				return err
			}
			states = append(states, state)
		}
		return rows.Err()
	})
	return states, pgErr(err)
}

func (s *PostgresStore) withTenantTx(ctx context.Context, tenantID string, fn func(pgx.Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT set_config('app.tenant_id', $1, true)`, tenantID); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func upsertLearnerState(ctx context.Context, tx pgx.Tx, state core.LearnerState) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO learner_states (
			tenant_id, learner_id, domain_id, concept_id, mastery, retention, confidence, ability,
			p_learn, p_forget, p_slip, p_guess, stability, difficulty, reps, lapses, card_state,
			due_at, last_interaction_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
		ON CONFLICT (tenant_id, learner_id, concept_id) DO UPDATE SET
			domain_id = EXCLUDED.domain_id,
			mastery = EXCLUDED.mastery,
			retention = EXCLUDED.retention,
			confidence = EXCLUDED.confidence,
			ability = EXCLUDED.ability,
			p_learn = EXCLUDED.p_learn,
			p_forget = EXCLUDED.p_forget,
			p_slip = EXCLUDED.p_slip,
			p_guess = EXCLUDED.p_guess,
			stability = EXCLUDED.stability,
			difficulty = EXCLUDED.difficulty,
			reps = EXCLUDED.reps,
			lapses = EXCLUDED.lapses,
			card_state = EXCLUDED.card_state,
			due_at = EXCLUDED.due_at,
			last_interaction_at = EXCLUDED.last_interaction_at,
			updated_at = EXCLUDED.updated_at
	`, state.TenantID, state.LearnerID, state.DomainID, state.ConceptID, state.Mastery, state.Retention, state.Confidence, state.Ability, state.PLearn, state.PForget, state.PSlip, state.PGuess, state.Stability, state.Difficulty, state.Reps, state.Lapses, string(state.CardState), state.DueAt, state.LastInteractionAt, state.UpdatedAt)
	return err
}

func upsertReviewCard(ctx context.Context, tx pgx.Tx, state core.LearnerState) error {
	if state.DueAt == nil {
		return nil
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO review_cards (tenant_id, learner_id, domain_id, concept_id, due_at, stability, difficulty, reps, lapses, state, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (tenant_id, learner_id, concept_id) DO UPDATE SET
			domain_id = EXCLUDED.domain_id,
			due_at = EXCLUDED.due_at,
			stability = EXCLUDED.stability,
			difficulty = EXCLUDED.difficulty,
			reps = EXCLUDED.reps,
			lapses = EXCLUDED.lapses,
			state = EXCLUDED.state,
			updated_at = EXCLUDED.updated_at
	`, state.TenantID, state.LearnerID, state.DomainID, state.ConceptID, state.DueAt, state.Stability, state.Difficulty, state.Reps, state.Lapses, string(state.CardState), state.UpdatedAt)
	return err
}

func saveMisconceptionChanges(ctx context.Context, tx pgx.Tx, misconceptions []core.Misconception) error {
	for _, misconception := range misconceptions {
		if misconception.ID == "" {
			return fmt.Errorf("%w: misconception id is required", core.ErrInvalidInput)
		}
		if misconception.Status == "RESOLVED" {
			tag, err := tx.Exec(ctx, `
				UPDATE misconceptions
				SET status = 'RESOLVED'
				WHERE tenant_id = $1 AND id = $2
			`, misconception.TenantID, misconception.ID)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return fmt.Errorf("%w: misconception", core.ErrNotFound)
			}
			continue
		}
		status := misconception.Status
		if status == "" {
			status = "ACTIVE"
		}
		createdAt := misconception.CreatedAt
		if createdAt.IsZero() {
			createdAt = time.Now().UTC()
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO misconceptions (tenant_id, id, learner_id, concept_id, description, severity, status, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			ON CONFLICT (tenant_id, id) DO UPDATE SET
				description = EXCLUDED.description,
				severity = EXCLUDED.severity,
				status = EXCLUDED.status
		`, misconception.TenantID, misconception.ID, misconception.LearnerID, misconception.ConceptID, misconception.Description, misconception.Severity, status, createdAt)
		if err != nil {
			return err
		}
	}
	return nil
}

func upsertAlertTx(ctx context.Context, tx pgx.Tx, alert core.Alert, now time.Time) error {
	if alert.TenantID == "" || alert.LearnerID == "" || alert.AlertType == "" {
		return nil
	}
	dedupeKey := alertDedupeKey(alert)
	var existingID, existingStatus string
	err := tx.QueryRow(ctx, `
		SELECT id::text, status
		FROM alerts
		WHERE tenant_id = $1 AND dedupe_key = $2
		FOR UPDATE
	`, alert.TenantID, dedupeKey).Scan(&existingID, &existingStatus)
	if errors.Is(err, pgx.ErrNoRows) {
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
		if _, err := tx.Exec(ctx, `
			INSERT INTO alerts (tenant_id, id, dedupe_key, learner_id, concept_id, alert_type, severity, status, payload_json, recommended_action, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		`, alert.TenantID, alert.ID, dedupeKey, alert.LearnerID, nullableString(alert.ConceptID), alert.AlertType, alert.Severity, alert.Status, mustJSON(alert.Payload), alert.RecommendedAction, alert.CreatedAt, alert.UpdatedAt); err != nil {
			return err
		}
		if err := insertEvent(ctx, tx, newStoreEvent(alert.TenantID, "AlertRaised", "alert", alert.ID, alert.CreatedAt, map[string]any{"alert_type": alert.AlertType, "learner_id": alert.LearnerID, "concept_id": alert.ConceptID})); err != nil {
			return err
		}
		if eventType, aggregateType, aggregateID, ok := alertDomainEvent(alert); ok {
			return insertEvent(ctx, tx, newStoreEvent(alert.TenantID, eventType, aggregateType, aggregateID, alert.CreatedAt, alertEventPayload(alert)))
		}
		return nil
	}
	if err != nil {
		return err
	}
	if existingStatus == "RESOLVED" {
		return nil
	}
	_, err = tx.Exec(ctx, `
		UPDATE alerts
		SET severity = $3, payload_json = $4, recommended_action = $5, updated_at = $6
		WHERE tenant_id = $1 AND id = $2
	`, alert.TenantID, existingID, alert.Severity, mustJSON(alert.Payload), alert.RecommendedAction, now)
	return err
}

func insertSnapshot(ctx context.Context, tx pgx.Tx, snapshot core.PedagogicalSnapshot) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO pedagogical_snapshots (tenant_id, id, interaction_id, activity_id, learner_id, domain_id, concept_id, before_json, observation_json, after_json, decision_json, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, snapshot.TenantID, snapshot.ID, nullableString(snapshot.InteractionID), nullableString(snapshot.ActivityID), snapshot.LearnerID, snapshot.DomainID, nullableString(snapshot.ConceptID), mustJSON(snapshot.Before), mustJSON(snapshot.Observation), mustJSON(snapshot.After), mustJSON(snapshot.Decision), snapshot.CreatedAt)
	return err
}

func insertEvent(ctx context.Context, tx pgx.Tx, event core.Event) error {
	if event.SchemaVersion <= 0 {
		event.SchemaVersion = 1
	}
	if event.CorrelationID == "" {
		event.CorrelationID = event.ID
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO event_outbox (tenant_id, id, schema_version, actor_user_id, correlation_id, causation_id, event_type, aggregate_type, aggregate_id, payload_json, occurred_at, published_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, event.TenantID, event.ID, event.SchemaVersion, event.ActorUserID, event.CorrelationID, event.CausationID, event.EventType, event.AggregateType, event.AggregateID, mustJSON(event.Payload), event.OccurredAt, event.PublishedAt)
	return err
}

func newStoreEvent(tenantID, eventType, aggregateType, aggregateID string, now time.Time, payload map[string]any) core.Event {
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

type interactionScanner interface {
	Scan(dest ...any) error
}

func scanInteraction(row interactionScanner) (core.Interaction, error) {
	var interaction core.Interaction
	var payloadRaw []byte
	err := row.Scan(&interaction.TenantID, &interaction.ID, &interaction.LearnerID, &interaction.ActivityID, &interaction.DomainID, &interaction.ConceptID, &interaction.Success, &interaction.Score, &interaction.ErrorType, &payloadRaw, &interaction.CreatedAt)
	interaction.Payload = decodeMap(payloadRaw)
	return interaction, err
}

func scanSnapshot(row interactionScanner) (core.PedagogicalSnapshot, error) {
	var snapshot core.PedagogicalSnapshot
	var beforeRaw, observationRaw, afterRaw, decisionRaw []byte
	err := row.Scan(&snapshot.TenantID, &snapshot.ID, &snapshot.InteractionID, &snapshot.ActivityID, &snapshot.LearnerID, &snapshot.DomainID, &snapshot.ConceptID, &beforeRaw, &observationRaw, &afterRaw, &decisionRaw, &snapshot.CreatedAt)
	snapshot.Before = decodeMap(beforeRaw)
	snapshot.Observation = decodeMap(observationRaw)
	snapshot.After = decodeMap(afterRaw)
	snapshot.Decision = decodeMap(decisionRaw)
	return snapshot, err
}

func scanEvent(row interactionScanner) (core.Event, error) {
	var event core.Event
	var payloadRaw []byte
	err := row.Scan(&event.TenantID, &event.ID, &event.SchemaVersion, &event.ActorUserID, &event.CorrelationID, &event.CausationID, &event.EventType, &event.AggregateType, &event.AggregateID, &payloadRaw, &event.OccurredAt, &event.PublishedAt)
	event.Payload = decodeMap(payloadRaw)
	return event, err
}

func scanAlert(row interactionScanner) (core.Alert, error) {
	var alert core.Alert
	var payloadRaw []byte
	err := row.Scan(&alert.TenantID, &alert.ID, &alert.LearnerID, &alert.ConceptID, &alert.AlertType, &alert.Severity, &alert.Status, &payloadRaw, &alert.RecommendedAction, &alert.CreatedAt, &alert.UpdatedAt)
	alert.Payload = decodeMap(payloadRaw)
	return alert, err
}

func mustJSON(v any) []byte {
	if v == nil {
		return []byte("{}")
	}
	data, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return data
}

func decodeMap(data []byte) map[string]any {
	if len(data) == 0 {
		return map[string]any{}
	}
	var result map[string]any
	if err := json.Unmarshal(data, &result); err != nil || result == nil {
		return map[string]any{}
	}
	return result
}

func decodeStrings(data []byte) []string {
	if len(data) == 0 {
		return nil
	}
	var result []string
	if err := json.Unmarshal(data, &result); err != nil {
		return nil
	}
	return result
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nullableTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value
}

func pgErr(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("%w: postgres row", core.ErrNotFound)
	}
	return err
}
