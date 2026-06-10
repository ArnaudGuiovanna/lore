package store

// B-11: satisfaction surveys (à chaud / à froid) + complaints register.
// Survey answers are validated against the survey's question set; complaints
// follow a small explicit workflow (OPEN → IN_PROGRESS → RESOLVED/CLOSED).

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"lore/internal/core"
	"lore/internal/ids"
)

// decodeJSON best-effort unmarshal for jsonb columns (nil target on failure).
func decodeJSON(data []byte, target any) {
	if len(data) == 0 {
		return
	}
	_ = json.Unmarshal(data, target)
}

var complaintStatuses = map[string]bool{"OPEN": true, "IN_PROGRESS": true, "RESOLVED": true, "CLOSED": true}

func validateSurvey(survey core.SatisfactionSurvey) error {
	if strings.TrimSpace(survey.Title) == "" {
		return fmt.Errorf("%w: survey title is required", core.ErrInvalidInput)
	}
	if survey.Kind != "HOT" && survey.Kind != "COLD" {
		return fmt.Errorf("%w: survey kind must be HOT or COLD", core.ErrInvalidInput)
	}
	if len(survey.Questions) == 0 {
		return fmt.Errorf("%w: at least one question is required", core.ErrInvalidInput)
	}
	seen := map[string]bool{}
	for _, q := range survey.Questions {
		if strings.TrimSpace(q.ID) == "" || strings.TrimSpace(q.Prompt) == "" {
			return fmt.Errorf("%w: every question needs an id and a prompt", core.ErrInvalidInput)
		}
		if q.Kind != "scale" && q.Kind != "text" {
			return fmt.Errorf("%w: question kind must be scale or text", core.ErrInvalidInput)
		}
		if seen[q.ID] {
			return fmt.Errorf("%w: duplicate question id %q", core.ErrInvalidInput, q.ID)
		}
		seen[q.ID] = true
	}
	return nil
}

// validateSurveyAnswers checks every answer maps to a question and scale
// answers are 1..5. Unanswered questions are allowed (partial honesty beats
// forced fake answers).
func validateSurveyAnswers(survey core.SatisfactionSurvey, answers map[string]any) error {
	if len(answers) == 0 {
		return fmt.Errorf("%w: at least one answer is required", core.ErrInvalidInput)
	}
	byID := map[string]core.SurveyQuestion{}
	for _, q := range survey.Questions {
		byID[q.ID] = q
	}
	for qid, value := range answers {
		q, ok := byID[qid]
		if !ok {
			return fmt.Errorf("%w: unknown question %q", core.ErrInvalidInput, qid)
		}
		if q.Kind == "scale" {
			n, ok := value.(float64)
			if !ok || n < 1 || n > 5 {
				return fmt.Errorf("%w: question %q expects a 1..5 rating", core.ErrInvalidInput, qid)
			}
		}
	}
	return nil
}

func surveyOpen(survey core.SatisfactionSurvey, now time.Time) error {
	if survey.ArchivedAt != nil {
		return fmt.Errorf("%w: survey archived", core.ErrInvalidInput)
	}
	if survey.OpensAt != nil && now.Before(*survey.OpensAt) {
		return fmt.Errorf("%w: survey not open yet", core.ErrInvalidInput)
	}
	if survey.ClosesAt != nil && now.After(*survey.ClosesAt) {
		return fmt.Errorf("%w: survey closed", core.ErrInvalidInput)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Memory store
// ---------------------------------------------------------------------------

func (s *MemoryStore) CreateSurvey(_ context.Context, survey core.SatisfactionSurvey, actorUserID ...string) (core.SatisfactionSurvey, error) {
	if err := validateSurvey(survey); err != nil {
		return core.SatisfactionSurvey{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.cohorts[key(survey.TenantID, survey.CohortID)]; !ok {
		return core.SatisfactionSurvey{}, fmt.Errorf("%w: cohort", core.ErrNotFound)
	}
	now := time.Now().UTC()
	survey.ID = ids.New()
	survey.Title = strings.TrimSpace(survey.Title)
	survey.CreatedBy = firstActor(actorUserID)
	survey.CreatedAt = now
	survey.ArchivedAt = nil
	s.surveys[key(survey.TenantID, survey.ID)] = survey
	s.recordAdminAuditLocked(survey.TenantID, survey.CreatedBy, "survey.create", "satisfaction_survey", survey.ID, map[string]any{"cohort_id": survey.CohortID, "kind": survey.Kind}, now)
	return survey, nil
}

func (s *MemoryStore) ListSurveys(_ context.Context, tenantID, cohortID string) ([]core.SatisfactionSurvey, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return nil, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	surveys := make([]core.SatisfactionSurvey, 0)
	for _, survey := range s.surveys {
		if survey.TenantID != tenantID || survey.ArchivedAt != nil {
			continue
		}
		if cohortID != "" && survey.CohortID != cohortID {
			continue
		}
		surveys = append(surveys, survey)
	}
	sort.Slice(surveys, func(i, j int) bool { return surveys[i].CreatedAt.After(surveys[j].CreatedAt) })
	return surveys, nil
}

func (s *MemoryStore) GetSurvey(_ context.Context, tenantID, surveyID string) (core.SatisfactionSurvey, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	survey, ok := s.surveys[key(tenantID, surveyID)]
	if !ok {
		return core.SatisfactionSurvey{}, fmt.Errorf("%w: survey", core.ErrNotFound)
	}
	return survey, nil
}

func (s *MemoryStore) SubmitSurveyResponse(_ context.Context, response core.SurveyResponse) (core.SurveyResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	survey, ok := s.surveys[key(response.TenantID, response.SurveyID)]
	if !ok {
		return core.SurveyResponse{}, fmt.Errorf("%w: survey", core.ErrNotFound)
	}
	now := time.Now().UTC()
	if err := surveyOpen(survey, now); err != nil {
		return core.SurveyResponse{}, err
	}
	if err := validateSurveyAnswers(survey, response.Answers); err != nil {
		return core.SurveyResponse{}, err
	}
	for _, existing := range s.surveyResponses {
		if existing.TenantID == response.TenantID && existing.SurveyID == response.SurveyID && existing.LearnerID == response.LearnerID {
			return core.SurveyResponse{}, fmt.Errorf("%w: this learner already answered this survey", core.ErrConflict)
		}
	}
	response.ID = ids.New()
	response.SubmittedAt = now
	s.surveyResponses[key(response.TenantID, response.ID)] = response
	return response, nil
}

func (s *MemoryStore) ListSurveyResponses(_ context.Context, tenantID, surveyID string) ([]core.SurveyResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.surveys[key(tenantID, surveyID)]; !ok {
		return nil, fmt.Errorf("%w: survey", core.ErrNotFound)
	}
	responses := make([]core.SurveyResponse, 0)
	for _, response := range s.surveyResponses {
		if response.TenantID == tenantID && response.SurveyID == surveyID {
			responses = append(responses, response)
		}
	}
	sort.Slice(responses, func(i, j int) bool { return responses[i].SubmittedAt.Before(responses[j].SubmittedAt) })
	return responses, nil
}

func (s *MemoryStore) CreateComplaint(_ context.Context, complaint core.Complaint) (core.Complaint, error) {
	if strings.TrimSpace(complaint.Subject) == "" {
		return core.Complaint{}, fmt.Errorf("%w: complaint subject is required", core.ErrInvalidInput)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tenants[complaint.TenantID]; !ok {
		return core.Complaint{}, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	now := time.Now().UTC()
	complaint.ID = ids.New()
	complaint.Status = "OPEN"
	complaint.CreatedAt = now
	complaint.UpdatedAt = now
	s.complaints[key(complaint.TenantID, complaint.ID)] = complaint
	s.recordAdminAuditLocked(complaint.TenantID, complaint.OpenedBy, "complaint.open", "complaint", complaint.ID, nil, now)
	return complaint, nil
}

func (s *MemoryStore) ListComplaints(_ context.Context, tenantID string) ([]core.Complaint, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return nil, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	complaints := make([]core.Complaint, 0)
	for _, complaint := range s.complaints {
		if complaint.TenantID == tenantID {
			complaints = append(complaints, complaint)
		}
	}
	sort.Slice(complaints, func(i, j int) bool { return complaints[i].CreatedAt.After(complaints[j].CreatedAt) })
	return complaints, nil
}

func (s *MemoryStore) UpdateComplaint(_ context.Context, tenantID, complaintID, status, resolution string, actorUserID ...string) (core.Complaint, error) {
	if !complaintStatuses[status] {
		return core.Complaint{}, fmt.Errorf("%w: status must be OPEN, IN_PROGRESS, RESOLVED or CLOSED", core.ErrInvalidInput)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	complaint, ok := s.complaints[key(tenantID, complaintID)]
	if !ok {
		return core.Complaint{}, fmt.Errorf("%w: complaint", core.ErrNotFound)
	}
	now := time.Now().UTC()
	complaint.Status = status
	if resolution != "" {
		complaint.Resolution = resolution
	}
	complaint.UpdatedAt = now
	if status == "RESOLVED" || status == "CLOSED" {
		complaint.ClosedAt = &now
	} else {
		complaint.ClosedAt = nil
	}
	s.complaints[key(tenantID, complaintID)] = complaint
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "complaint.update", "complaint", complaintID, map[string]any{"status": status}, now)
	return complaint, nil
}

// ---------------------------------------------------------------------------
// Postgres store
// ---------------------------------------------------------------------------

const surveyColumns = `tenant_id::text, id::text, cohort_id::text, kind, title, questions, opens_at, closes_at, created_by, created_at, archived_at`

func scanSurvey(row pgScanner) (core.SatisfactionSurvey, error) {
	var survey core.SatisfactionSurvey
	var questionsRaw []byte
	if err := row.Scan(&survey.TenantID, &survey.ID, &survey.CohortID, &survey.Kind, &survey.Title, &questionsRaw, &survey.OpensAt, &survey.ClosesAt, &survey.CreatedBy, &survey.CreatedAt, &survey.ArchivedAt); err != nil {
		return core.SatisfactionSurvey{}, err
	}
	decodeJSON(questionsRaw, &survey.Questions)
	return survey, nil
}

func (s *PostgresStore) CreateSurvey(ctx context.Context, survey core.SatisfactionSurvey, actorUserID ...string) (core.SatisfactionSurvey, error) {
	if err := validateSurvey(survey); err != nil {
		return core.SatisfactionSurvey{}, err
	}
	survey.ID = ids.New()
	survey.Title = strings.TrimSpace(survey.Title)
	survey.CreatedBy = firstActor(actorUserID)
	survey.CreatedAt = time.Now().UTC()
	err := s.withTenantTx(ctx, survey.TenantID, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM cohorts WHERE tenant_id = $1 AND id = $2)`, survey.TenantID, survey.CohortID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("%w: cohort", core.ErrNotFound)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO satisfaction_surveys (tenant_id, id, cohort_id, kind, title, questions, opens_at, closes_at, created_by, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		`, survey.TenantID, survey.ID, survey.CohortID, survey.Kind, survey.Title, mustJSON(survey.Questions), survey.OpensAt, survey.ClosesAt, survey.CreatedBy, survey.CreatedAt); err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(survey.TenantID, survey.CreatedBy, "survey.create", "satisfaction_survey", survey.ID, map[string]any{"cohort_id": survey.CohortID, "kind": survey.Kind}, survey.CreatedAt))
	})
	if err != nil {
		return core.SatisfactionSurvey{}, pgErr(err)
	}
	return survey, nil
}

func (s *PostgresStore) ListSurveys(ctx context.Context, tenantID, cohortID string) ([]core.SatisfactionSurvey, error) {
	var surveys []core.SatisfactionSurvey
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		query := `SELECT ` + surveyColumns + ` FROM satisfaction_surveys WHERE tenant_id = $1 AND archived_at IS NULL`
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
			survey, err := scanSurvey(rows)
			if err != nil {
				return err
			}
			surveys = append(surveys, survey)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, pgErr(err)
	}
	if surveys == nil {
		surveys = []core.SatisfactionSurvey{}
	}
	return surveys, nil
}

func (s *PostgresStore) GetSurvey(ctx context.Context, tenantID, surveyID string) (core.SatisfactionSurvey, error) {
	var survey core.SatisfactionSurvey
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `SELECT `+surveyColumns+` FROM satisfaction_surveys WHERE tenant_id = $1 AND id = $2`, tenantID, surveyID)
		var err error
		survey, err = scanSurvey(row)
		return err
	})
	if err != nil {
		return core.SatisfactionSurvey{}, pgErr(err)
	}
	return survey, nil
}

func (s *PostgresStore) SubmitSurveyResponse(ctx context.Context, response core.SurveyResponse) (core.SurveyResponse, error) {
	err := s.withTenantTx(ctx, response.TenantID, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `SELECT `+surveyColumns+` FROM satisfaction_surveys WHERE tenant_id = $1 AND id = $2`, response.TenantID, response.SurveyID)
		survey, err := scanSurvey(row)
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		if err := surveyOpen(survey, now); err != nil {
			return err
		}
		if err := validateSurveyAnswers(survey, response.Answers); err != nil {
			return err
		}
		response.ID = ids.New()
		response.SubmittedAt = now
		tag, err := tx.Exec(ctx, `
			INSERT INTO satisfaction_responses (tenant_id, id, survey_id, learner_id, answers, submitted_at)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (tenant_id, survey_id, learner_id) DO NOTHING
		`, response.TenantID, response.ID, response.SurveyID, response.LearnerID, mustJSON(response.Answers), response.SubmittedAt)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("%w: this learner already answered this survey", core.ErrConflict)
		}
		return nil
	})
	if err != nil {
		return core.SurveyResponse{}, pgErr(err)
	}
	return response, nil
}

func (s *PostgresStore) ListSurveyResponses(ctx context.Context, tenantID, surveyID string) ([]core.SurveyResponse, error) {
	var responses []core.SurveyResponse
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM satisfaction_surveys WHERE tenant_id = $1 AND id = $2)`, tenantID, surveyID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("%w: survey", core.ErrNotFound)
		}
		rows, err := tx.Query(ctx, `
			SELECT tenant_id::text, id::text, survey_id::text, learner_id::text, answers, submitted_at
			FROM satisfaction_responses
			WHERE tenant_id = $1 AND survey_id = $2
			ORDER BY submitted_at
		`, tenantID, surveyID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var response core.SurveyResponse
			var answersRaw []byte
			if err := rows.Scan(&response.TenantID, &response.ID, &response.SurveyID, &response.LearnerID, &answersRaw, &response.SubmittedAt); err != nil {
				return err
			}
			decodeJSON(answersRaw, &response.Answers)
			responses = append(responses, response)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, pgErr(err)
	}
	if responses == nil {
		responses = []core.SurveyResponse{}
	}
	return responses, nil
}

const complaintColumns = `tenant_id::text, id::text, opened_by, COALESCE(learner_id, ''), subject, description, status, resolution, created_at, updated_at, closed_at`

func scanComplaint(row pgScanner) (core.Complaint, error) {
	var complaint core.Complaint
	if err := row.Scan(&complaint.TenantID, &complaint.ID, &complaint.OpenedBy, &complaint.LearnerID, &complaint.Subject, &complaint.Description, &complaint.Status, &complaint.Resolution, &complaint.CreatedAt, &complaint.UpdatedAt, &complaint.ClosedAt); err != nil {
		return core.Complaint{}, err
	}
	return complaint, nil
}

func (s *PostgresStore) CreateComplaint(ctx context.Context, complaint core.Complaint) (core.Complaint, error) {
	if strings.TrimSpace(complaint.Subject) == "" {
		return core.Complaint{}, fmt.Errorf("%w: complaint subject is required", core.ErrInvalidInput)
	}
	now := time.Now().UTC()
	complaint.ID = ids.New()
	complaint.Status = "OPEN"
	complaint.CreatedAt = now
	complaint.UpdatedAt = now
	err := s.withTenantTx(ctx, complaint.TenantID, func(tx pgx.Tx) error {
		var learnerID any
		if complaint.LearnerID != "" {
			learnerID = complaint.LearnerID
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO complaints (tenant_id, id, opened_by, learner_id, subject, description, status, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
		`, complaint.TenantID, complaint.ID, complaint.OpenedBy, learnerID, complaint.Subject, complaint.Description, complaint.Status, now); err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(complaint.TenantID, complaint.OpenedBy, "complaint.open", "complaint", complaint.ID, nil, now))
	})
	if err != nil {
		return core.Complaint{}, pgErr(err)
	}
	return complaint, nil
}

func (s *PostgresStore) ListComplaints(ctx context.Context, tenantID string) ([]core.Complaint, error) {
	var complaints []core.Complaint
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT `+complaintColumns+` FROM complaints WHERE tenant_id = $1 ORDER BY created_at DESC`, tenantID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			complaint, err := scanComplaint(rows)
			if err != nil {
				return err
			}
			complaints = append(complaints, complaint)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, pgErr(err)
	}
	if complaints == nil {
		complaints = []core.Complaint{}
	}
	return complaints, nil
}

func (s *PostgresStore) UpdateComplaint(ctx context.Context, tenantID, complaintID, status, resolution string, actorUserID ...string) (core.Complaint, error) {
	if !complaintStatuses[status] {
		return core.Complaint{}, fmt.Errorf("%w: status must be OPEN, IN_PROGRESS, RESOLVED or CLOSED", core.ErrInvalidInput)
	}
	var complaint core.Complaint
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		now := time.Now().UTC()
		row := tx.QueryRow(ctx, `
			UPDATE complaints
			SET status = $3,
				resolution = CASE WHEN $4 <> '' THEN $4 ELSE resolution END,
				updated_at = $5,
				closed_at = CASE WHEN $3 IN ('RESOLVED', 'CLOSED') THEN $5 ELSE NULL END
			WHERE tenant_id = $1 AND id = $2
			RETURNING `+complaintColumns+`
		`, tenantID, complaintID, status, resolution, now)
		var err error
		complaint, err = scanComplaint(row)
		if err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(tenantID, firstActor(actorUserID), "complaint.update", "complaint", complaintID, map[string]any{"status": status}, now))
	})
	if err != nil {
		return core.Complaint{}, pgErr(err)
	}
	return complaint, nil
}
