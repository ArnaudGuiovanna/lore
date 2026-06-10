package store

// B-26: trainer question bank + assignments (devoirs) + manual grading.
// Bank questions feed runtime assessments (keys stay server-side); graded
// assignments optionally bridge into BKT via the engine (handler-level).

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

func validateBankQuestion(q core.BankQuestion) error {
	if strings.TrimSpace(q.Prompt) == "" {
		return fmt.Errorf("%w: question prompt is required", core.ErrInvalidInput)
	}
	switch q.Kind {
	case "single_choice":
		if len(q.Choices) < 2 {
			return fmt.Errorf("%w: single_choice needs at least two choices", core.ErrInvalidInput)
		}
		found := false
		for _, choice := range q.Choices {
			if choice.ID == q.CorrectChoiceID {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("%w: correct_choice_id must reference one of the choices", core.ErrInvalidInput)
		}
	case "short_answer":
		if strings.TrimSpace(q.ExpectedAnswer) == "" {
			return fmt.Errorf("%w: short_answer needs an expected_answer", core.ErrInvalidInput)
		}
	default:
		return fmt.Errorf("%w: kind must be single_choice or short_answer", core.ErrInvalidInput)
	}
	if q.Points <= 0 {
		return fmt.Errorf("%w: points must be > 0", core.ErrInvalidInput)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Memory store — question bank
// ---------------------------------------------------------------------------

func (s *MemoryStore) CreateBankQuestion(_ context.Context, q core.BankQuestion, actorUserID ...string) (core.BankQuestion, error) {
	if q.Points == 0 {
		q.Points = 1
	}
	if err := validateBankQuestion(q); err != nil {
		return core.BankQuestion{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tenants[q.TenantID]; !ok {
		return core.BankQuestion{}, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	now := time.Now().UTC()
	q.ID = ids.New()
	q.CreatedBy = firstActor(actorUserID)
	q.CreatedAt = now
	q.UpdatedAt = now
	q.ArchivedAt = nil
	s.bankQuestions[key(q.TenantID, q.ID)] = q
	s.recordAdminAuditLocked(q.TenantID, q.CreatedBy, "question.create", "bank_question", q.ID, map[string]any{"concept_id": q.ConceptID}, now)
	return q, nil
}

func (s *MemoryStore) ListBankQuestions(_ context.Context, tenantID, conceptID string) ([]core.BankQuestion, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	questions := make([]core.BankQuestion, 0)
	for _, q := range s.bankQuestions {
		if q.TenantID != tenantID || q.ArchivedAt != nil {
			continue
		}
		if conceptID != "" && q.ConceptID != conceptID {
			continue
		}
		questions = append(questions, q)
	}
	sort.Slice(questions, func(i, j int) bool { return questions[i].CreatedAt.Before(questions[j].CreatedAt) })
	return questions, nil
}

func (s *MemoryStore) GetBankQuestion(_ context.Context, tenantID, questionID string) (core.BankQuestion, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	q, ok := s.bankQuestions[key(tenantID, questionID)]
	if !ok || q.ArchivedAt != nil {
		return core.BankQuestion{}, fmt.Errorf("%w: question", core.ErrNotFound)
	}
	return q, nil
}

func (s *MemoryStore) ArchiveBankQuestion(_ context.Context, tenantID, questionID string, actorUserID ...string) (core.BankQuestion, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	q, ok := s.bankQuestions[key(tenantID, questionID)]
	if !ok || q.ArchivedAt != nil {
		return core.BankQuestion{}, fmt.Errorf("%w: question", core.ErrNotFound)
	}
	now := time.Now().UTC()
	q.ArchivedAt = &now
	q.UpdatedAt = now
	s.bankQuestions[key(tenantID, questionID)] = q
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "question.archive", "bank_question", questionID, nil, now)
	return q, nil
}

// ---------------------------------------------------------------------------
// Memory store — assignments
// ---------------------------------------------------------------------------

func (s *MemoryStore) CreateAssignment(_ context.Context, assignment core.Assignment, actorUserID ...string) (core.Assignment, error) {
	if strings.TrimSpace(assignment.Title) == "" {
		return core.Assignment{}, fmt.Errorf("%w: assignment title is required", core.ErrInvalidInput)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.cohorts[key(assignment.TenantID, assignment.CohortID)]; !ok {
		return core.Assignment{}, fmt.Errorf("%w: cohort", core.ErrNotFound)
	}
	now := time.Now().UTC()
	assignment.ID = ids.New()
	assignment.CreatedBy = firstActor(actorUserID)
	assignment.CreatedAt = now
	assignment.ArchivedAt = nil
	s.assignments[key(assignment.TenantID, assignment.ID)] = assignment
	s.recordAdminAuditLocked(assignment.TenantID, assignment.CreatedBy, "assignment.create", "assignment", assignment.ID, map[string]any{"cohort_id": assignment.CohortID}, now)
	return assignment, nil
}

func (s *MemoryStore) ListAssignments(_ context.Context, tenantID, cohortID string) ([]core.Assignment, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return nil, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	assignments := make([]core.Assignment, 0)
	for _, assignment := range s.assignments {
		if assignment.TenantID != tenantID || assignment.ArchivedAt != nil {
			continue
		}
		if cohortID != "" && assignment.CohortID != cohortID {
			continue
		}
		assignments = append(assignments, assignment)
	}
	sort.Slice(assignments, func(i, j int) bool { return assignments[i].CreatedAt.After(assignments[j].CreatedAt) })
	return assignments, nil
}

func (s *MemoryStore) GetAssignment(_ context.Context, tenantID, assignmentID string) (core.Assignment, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	assignment, ok := s.assignments[key(tenantID, assignmentID)]
	if !ok || assignment.ArchivedAt != nil {
		return core.Assignment{}, fmt.Errorf("%w: assignment", core.ErrNotFound)
	}
	return assignment, nil
}

func (s *MemoryStore) SubmitAssignment(_ context.Context, submission core.AssignmentSubmission) (core.AssignmentSubmission, error) {
	if strings.TrimSpace(submission.Content) == "" {
		return core.AssignmentSubmission{}, fmt.Errorf("%w: submission content is required", core.ErrInvalidInput)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.assignments[key(submission.TenantID, submission.AssignmentID)]; !ok {
		return core.AssignmentSubmission{}, fmt.Errorf("%w: assignment", core.ErrNotFound)
	}
	for k, existing := range s.assignmentSubmissions {
		if existing.TenantID == submission.TenantID && existing.AssignmentID == submission.AssignmentID && existing.LearnerID == submission.LearnerID {
			// Resubmission before grading replaces the previous copy.
			if existing.GradedAt != nil {
				return core.AssignmentSubmission{}, fmt.Errorf("%w: submission already graded", core.ErrConflict)
			}
			delete(s.assignmentSubmissions, k)
		}
	}
	submission.ID = ids.New()
	submission.SubmittedAt = time.Now().UTC()
	submission.Score = nil
	submission.Feedback = ""
	submission.GradedBy = ""
	submission.GradedAt = nil
	s.assignmentSubmissions[key(submission.TenantID, submission.ID)] = submission
	return submission, nil
}

func (s *MemoryStore) ListAssignmentSubmissions(_ context.Context, tenantID, assignmentID string) ([]core.AssignmentSubmission, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.assignments[key(tenantID, assignmentID)]; !ok {
		return nil, fmt.Errorf("%w: assignment", core.ErrNotFound)
	}
	submissions := make([]core.AssignmentSubmission, 0)
	for _, submission := range s.assignmentSubmissions {
		if submission.TenantID == tenantID && submission.AssignmentID == assignmentID {
			submissions = append(submissions, submission)
		}
	}
	sort.Slice(submissions, func(i, j int) bool { return submissions[i].SubmittedAt.Before(submissions[j].SubmittedAt) })
	return submissions, nil
}

func (s *MemoryStore) GradeAssignmentSubmission(_ context.Context, tenantID, submissionID string, score float64, feedback, graderID string) (core.AssignmentSubmission, error) {
	if score < 0 || score > 1 {
		return core.AssignmentSubmission{}, fmt.Errorf("%w: score must be in [0,1]", core.ErrInvalidInput)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	submission, ok := s.assignmentSubmissions[key(tenantID, submissionID)]
	if !ok {
		return core.AssignmentSubmission{}, fmt.Errorf("%w: submission", core.ErrNotFound)
	}
	now := time.Now().UTC()
	submission.Score = &score
	submission.Feedback = feedback
	submission.GradedBy = graderID
	submission.GradedAt = &now
	s.assignmentSubmissions[key(tenantID, submissionID)] = submission
	s.recordAdminAuditLocked(tenantID, graderID, "submission.grade", "assignment_submission", submissionID, map[string]any{"score": score}, now)
	return submission, nil
}

// ---------------------------------------------------------------------------
// Postgres store — question bank
// ---------------------------------------------------------------------------

const bankColumns = `tenant_id::text, id::text, COALESCE(concept_id, ''), kind, prompt, choices, correct_choice_id, expected_answer, points, created_by, created_at, updated_at, archived_at`

func scanBankQuestion(row pgScanner) (core.BankQuestion, error) {
	var q core.BankQuestion
	var choicesRaw []byte
	if err := row.Scan(&q.TenantID, &q.ID, &q.ConceptID, &q.Kind, &q.Prompt, &choicesRaw, &q.CorrectChoiceID, &q.ExpectedAnswer, &q.Points, &q.CreatedBy, &q.CreatedAt, &q.UpdatedAt, &q.ArchivedAt); err != nil {
		return core.BankQuestion{}, err
	}
	decodeJSON(choicesRaw, &q.Choices)
	return q, nil
}

func (s *PostgresStore) CreateBankQuestion(ctx context.Context, q core.BankQuestion, actorUserID ...string) (core.BankQuestion, error) {
	if q.Points == 0 {
		q.Points = 1
	}
	if err := validateBankQuestion(q); err != nil {
		return core.BankQuestion{}, err
	}
	now := time.Now().UTC()
	q.ID = ids.New()
	q.CreatedBy = firstActor(actorUserID)
	q.CreatedAt = now
	q.UpdatedAt = now
	err := s.withTenantTx(ctx, q.TenantID, func(tx pgx.Tx) error {
		var conceptID any
		if q.ConceptID != "" {
			conceptID = q.ConceptID
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO question_bank (tenant_id, id, concept_id, kind, prompt, choices, correct_choice_id, expected_answer, points, created_by, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
		`, q.TenantID, q.ID, conceptID, q.Kind, q.Prompt, mustJSON(q.Choices), q.CorrectChoiceID, q.ExpectedAnswer, q.Points, q.CreatedBy, now); err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(q.TenantID, q.CreatedBy, "question.create", "bank_question", q.ID, map[string]any{"concept_id": q.ConceptID}, now))
	})
	if err != nil {
		return core.BankQuestion{}, pgErr(err)
	}
	return q, nil
}

func (s *PostgresStore) ListBankQuestions(ctx context.Context, tenantID, conceptID string) ([]core.BankQuestion, error) {
	var questions []core.BankQuestion
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		query := `SELECT ` + bankColumns + ` FROM question_bank WHERE tenant_id = $1 AND archived_at IS NULL`
		args := []any{tenantID}
		if conceptID != "" {
			query += ` AND concept_id = $2`
			args = append(args, conceptID)
		}
		query += ` ORDER BY created_at`
		rows, err := tx.Query(ctx, query, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			q, err := scanBankQuestion(rows)
			if err != nil {
				return err
			}
			questions = append(questions, q)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, pgErr(err)
	}
	if questions == nil {
		questions = []core.BankQuestion{}
	}
	return questions, nil
}

func (s *PostgresStore) GetBankQuestion(ctx context.Context, tenantID, questionID string) (core.BankQuestion, error) {
	var q core.BankQuestion
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `SELECT `+bankColumns+` FROM question_bank WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL`, tenantID, questionID)
		var err error
		q, err = scanBankQuestion(row)
		return err
	})
	if err != nil {
		return core.BankQuestion{}, pgErr(err)
	}
	return q, nil
}

func (s *PostgresStore) ArchiveBankQuestion(ctx context.Context, tenantID, questionID string, actorUserID ...string) (core.BankQuestion, error) {
	var q core.BankQuestion
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		now := time.Now().UTC()
		row := tx.QueryRow(ctx, `
			UPDATE question_bank SET archived_at = $3, updated_at = $3
			WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL
			RETURNING `+bankColumns, tenantID, questionID, now)
		var err error
		q, err = scanBankQuestion(row)
		if err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(tenantID, firstActor(actorUserID), "question.archive", "bank_question", questionID, nil, now))
	})
	if err != nil {
		return core.BankQuestion{}, pgErr(err)
	}
	return q, nil
}

// ---------------------------------------------------------------------------
// Postgres store — assignments
// ---------------------------------------------------------------------------

const assignmentColumns = `tenant_id::text, id::text, cohort_id::text, domain_id, concept_id, title, description, due_at, created_by, created_at, archived_at`

func scanAssignment(row pgScanner) (core.Assignment, error) {
	var a core.Assignment
	if err := row.Scan(&a.TenantID, &a.ID, &a.CohortID, &a.DomainID, &a.ConceptID, &a.Title, &a.Description, &a.DueAt, &a.CreatedBy, &a.CreatedAt, &a.ArchivedAt); err != nil {
		return core.Assignment{}, err
	}
	return a, nil
}

func (s *PostgresStore) CreateAssignment(ctx context.Context, assignment core.Assignment, actorUserID ...string) (core.Assignment, error) {
	if strings.TrimSpace(assignment.Title) == "" {
		return core.Assignment{}, fmt.Errorf("%w: assignment title is required", core.ErrInvalidInput)
	}
	now := time.Now().UTC()
	assignment.ID = ids.New()
	assignment.CreatedBy = firstActor(actorUserID)
	assignment.CreatedAt = now
	err := s.withTenantTx(ctx, assignment.TenantID, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM cohorts WHERE tenant_id = $1 AND id = $2)`, assignment.TenantID, assignment.CohortID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("%w: cohort", core.ErrNotFound)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO assignments (tenant_id, id, cohort_id, domain_id, concept_id, title, description, due_at, created_by, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		`, assignment.TenantID, assignment.ID, assignment.CohortID, assignment.DomainID, assignment.ConceptID, assignment.Title, assignment.Description, assignment.DueAt, assignment.CreatedBy, now); err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(assignment.TenantID, assignment.CreatedBy, "assignment.create", "assignment", assignment.ID, map[string]any{"cohort_id": assignment.CohortID}, now))
	})
	if err != nil {
		return core.Assignment{}, pgErr(err)
	}
	return assignment, nil
}

func (s *PostgresStore) ListAssignments(ctx context.Context, tenantID, cohortID string) ([]core.Assignment, error) {
	var assignments []core.Assignment
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		query := `SELECT ` + assignmentColumns + ` FROM assignments WHERE tenant_id = $1 AND archived_at IS NULL`
		args := []any{tenantID}
		if cohortID != "" {
			query += ` AND cohort_id = $2`
			args = append(args, cohortID)
		}
		query += ` ORDER BY created_at DESC`
		rows, err := tx.Query(ctx, query, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			assignment, err := scanAssignment(rows)
			if err != nil {
				return err
			}
			assignments = append(assignments, assignment)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, pgErr(err)
	}
	if assignments == nil {
		assignments = []core.Assignment{}
	}
	return assignments, nil
}

func (s *PostgresStore) GetAssignment(ctx context.Context, tenantID, assignmentID string) (core.Assignment, error) {
	var assignment core.Assignment
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `SELECT `+assignmentColumns+` FROM assignments WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL`, tenantID, assignmentID)
		var err error
		assignment, err = scanAssignment(row)
		return err
	})
	if err != nil {
		return core.Assignment{}, pgErr(err)
	}
	return assignment, nil
}

const submissionColumns = `tenant_id::text, id::text, assignment_id::text, learner_id::text, content, submitted_at, score, feedback, graded_by, graded_at`

func scanSubmission(row pgScanner) (core.AssignmentSubmission, error) {
	var sub core.AssignmentSubmission
	if err := row.Scan(&sub.TenantID, &sub.ID, &sub.AssignmentID, &sub.LearnerID, &sub.Content, &sub.SubmittedAt, &sub.Score, &sub.Feedback, &sub.GradedBy, &sub.GradedAt); err != nil {
		return core.AssignmentSubmission{}, err
	}
	return sub, nil
}

func (s *PostgresStore) SubmitAssignment(ctx context.Context, submission core.AssignmentSubmission) (core.AssignmentSubmission, error) {
	if strings.TrimSpace(submission.Content) == "" {
		return core.AssignmentSubmission{}, fmt.Errorf("%w: submission content is required", core.ErrInvalidInput)
	}
	submission.ID = ids.New()
	submission.SubmittedAt = time.Now().UTC()
	err := s.withTenantTx(ctx, submission.TenantID, func(tx pgx.Tx) error {
		var graded bool
		err := tx.QueryRow(ctx, `
			SELECT graded_at IS NOT NULL FROM assignment_submissions
			WHERE tenant_id = $1 AND assignment_id = $2 AND learner_id = $3
		`, submission.TenantID, submission.AssignmentID, submission.LearnerID).Scan(&graded)
		if err == nil {
			if graded {
				return fmt.Errorf("%w: submission already graded", core.ErrConflict)
			}
			// Resubmission before grading replaces the previous copy.
			if _, err := tx.Exec(ctx, `
				DELETE FROM assignment_submissions
				WHERE tenant_id = $1 AND assignment_id = $2 AND learner_id = $3
			`, submission.TenantID, submission.AssignmentID, submission.LearnerID); err != nil {
				return err
			}
		} else if err != pgx.ErrNoRows {
			return err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO assignment_submissions (tenant_id, id, assignment_id, learner_id, content, submitted_at)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, submission.TenantID, submission.ID, submission.AssignmentID, submission.LearnerID, submission.Content, submission.SubmittedAt)
		return err
	})
	if err != nil {
		return core.AssignmentSubmission{}, pgErr(err)
	}
	return submission, nil
}

func (s *PostgresStore) ListAssignmentSubmissions(ctx context.Context, tenantID, assignmentID string) ([]core.AssignmentSubmission, error) {
	var submissions []core.AssignmentSubmission
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM assignments WHERE tenant_id = $1 AND id = $2)`, tenantID, assignmentID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("%w: assignment", core.ErrNotFound)
		}
		rows, err := tx.Query(ctx, `SELECT `+submissionColumns+` FROM assignment_submissions WHERE tenant_id = $1 AND assignment_id = $2 ORDER BY submitted_at`, tenantID, assignmentID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			submission, err := scanSubmission(rows)
			if err != nil {
				return err
			}
			submissions = append(submissions, submission)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, pgErr(err)
	}
	if submissions == nil {
		submissions = []core.AssignmentSubmission{}
	}
	return submissions, nil
}

func (s *PostgresStore) GradeAssignmentSubmission(ctx context.Context, tenantID, submissionID string, score float64, feedback, graderID string) (core.AssignmentSubmission, error) {
	if score < 0 || score > 1 {
		return core.AssignmentSubmission{}, fmt.Errorf("%w: score must be in [0,1]", core.ErrInvalidInput)
	}
	var submission core.AssignmentSubmission
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		now := time.Now().UTC()
		row := tx.QueryRow(ctx, `
			UPDATE assignment_submissions
			SET score = $3, feedback = $4, graded_by = $5, graded_at = $6
			WHERE tenant_id = $1 AND id = $2
			RETURNING `+submissionColumns, tenantID, submissionID, score, feedback, graderID, now)
		var err error
		submission, err = scanSubmission(row)
		if err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(tenantID, graderID, "submission.grade", "assignment_submission", submissionID, map[string]any{"score": score}, now))
	})
	if err != nil {
		return core.AssignmentSubmission{}, pgErr(err)
	}
	return submission, nil
}
