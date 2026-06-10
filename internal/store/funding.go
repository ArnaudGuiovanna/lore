package store

// B-15: dossiers de financement + export BPF annuel. Les connecteurs
// EDOF/Kairos ne sont pas implémentés : ce modèle est leur source de vérité.

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

var fundingFunderTypes = map[string]bool{
	"CPF": true, "OPCO": true, "FRANCE_TRAVAIL": true,
	"EMPLOYEUR": true, "AUTOFINANCEMENT": true, "AUTRE": true,
}

var fundingStatuses = map[string]bool{
	"EN_INSTRUCTION": true, "ACCEPTE": true, "REFUSE": true, "SOLDE": true,
}

func validateFundingFile(file core.FundingFile) error {
	if strings.TrimSpace(file.LearnerID) == "" {
		return fmt.Errorf("%w: learner_id is required", core.ErrInvalidInput)
	}
	if !fundingFunderTypes[file.FunderType] {
		return fmt.Errorf("%w: funder_type must be one of CPF, OPCO, FRANCE_TRAVAIL, EMPLOYEUR, AUTOFINANCEMENT, AUTRE", core.ErrInvalidInput)
	}
	if file.Status != "" && !fundingStatuses[file.Status] {
		return fmt.Errorf("%w: status must be one of EN_INSTRUCTION, ACCEPTE, REFUSE, SOLDE", core.ErrInvalidInput)
	}
	if file.AmountCents < 0 {
		return fmt.Errorf("%w: amount_cents cannot be negative", core.ErrInvalidInput)
	}
	return nil
}

func applyFundingPatch(file core.FundingFile, patch core.FundingFilePatch) (core.FundingFile, error) {
	if patch.FunderType != nil {
		file.FunderType = *patch.FunderType
	}
	if patch.FunderName != nil {
		file.FunderName = *patch.FunderName
	}
	if patch.Reference != nil {
		file.Reference = *patch.Reference
	}
	if patch.Status != nil {
		file.Status = *patch.Status
	}
	if patch.AmountCents != nil {
		file.AmountCents = *patch.AmountCents
	}
	if patch.Notes != nil {
		file.Notes = *patch.Notes
	}
	if patch.CohortID != nil {
		file.CohortID = *patch.CohortID
	}
	return file, validateFundingFile(file)
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

func (s *MemoryStore) CreateFundingFile(_ context.Context, file core.FundingFile, actorUserID ...string) (core.FundingFile, error) {
	if file.Status == "" {
		file.Status = "EN_INSTRUCTION"
	}
	if err := validateFundingFile(file); err != nil {
		return core.FundingFile{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tenants[file.TenantID]; !ok {
		return core.FundingFile{}, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	now := time.Now().UTC()
	file.ID = ids.New()
	file.CreatedAt = now
	file.UpdatedAt = now
	file.ArchivedAt = nil
	s.fundingFiles[key(file.TenantID, file.ID)] = file
	s.recordAdminAuditLocked(file.TenantID, firstActor(actorUserID), "funding_file.create", "funding_file", file.ID, map[string]any{"learner_id": file.LearnerID, "funder_type": file.FunderType}, now)
	return file, nil
}

func (s *MemoryStore) ListFundingFiles(_ context.Context, tenantID, learnerID string) ([]core.FundingFile, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return nil, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	files := make([]core.FundingFile, 0)
	for _, file := range s.fundingFiles {
		if file.TenantID != tenantID || file.ArchivedAt != nil {
			continue
		}
		if learnerID != "" && file.LearnerID != learnerID {
			continue
		}
		files = append(files, file)
	}
	sort.Slice(files, func(i, j int) bool { return files[i].CreatedAt.After(files[j].CreatedAt) })
	return files, nil
}

func (s *MemoryStore) UpdateFundingFile(_ context.Context, tenantID, fileID string, patch core.FundingFilePatch, actorUserID ...string) (core.FundingFile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, ok := s.fundingFiles[key(tenantID, fileID)]
	if !ok || file.ArchivedAt != nil {
		return core.FundingFile{}, fmt.Errorf("%w: funding file", core.ErrNotFound)
	}
	updated, err := applyFundingPatch(file, patch)
	if err != nil {
		return core.FundingFile{}, err
	}
	now := time.Now().UTC()
	updated.UpdatedAt = now
	s.fundingFiles[key(tenantID, fileID)] = updated
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "funding_file.update", "funding_file", fileID, nil, now)
	return updated, nil
}

func (s *MemoryStore) ArchiveFundingFile(_ context.Context, tenantID, fileID string, actorUserID ...string) (core.FundingFile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, ok := s.fundingFiles[key(tenantID, fileID)]
	if !ok || file.ArchivedAt != nil {
		return core.FundingFile{}, fmt.Errorf("%w: funding file", core.ErrNotFound)
	}
	now := time.Now().UTC()
	file.ArchivedAt = &now
	file.UpdatedAt = now
	s.fundingFiles[key(tenantID, fileID)] = file
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "funding_file.archive", "funding_file", fileID, nil, now)
	return file, nil
}

// BPFExport agrège l'année civile : dossiers par origine de financement
// (cadre C du BPF) + stagiaires distincts et heures suivies (cadre F). Les
// heures viennent du temps d'activité réellement tracé (B-07), pas du
// déclaratif.
func (s *MemoryStore) BPFExport(_ context.Context, tenantID string, year int) (core.BPFReport, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return core.BPFReport{}, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	report := core.BPFReport{Year: year}
	learners := map[string]bool{}
	var totalSeconds int64
	for _, activity := range s.activities {
		if activity.TenantID != tenantID || activity.CompletedAt == nil || activity.CompletedAt.Year() != year {
			continue
		}
		seconds := trackedActivitySeconds(activity.StartedAt, activity.CompletedAt, activity.PausedSeconds)
		if seconds > 0 {
			totalSeconds += seconds
			learners[activity.LearnerID] = true
		}
	}
	byFunder := map[string]*core.BPFFunderLine{}
	funderLearners := map[string]map[string]bool{}
	for _, file := range s.fundingFiles {
		if file.TenantID != tenantID || file.ArchivedAt != nil || file.CreatedAt.Year() != year {
			continue
		}
		line, ok := byFunder[file.FunderType]
		if !ok {
			line = &core.BPFFunderLine{FunderType: file.FunderType}
			byFunder[file.FunderType] = line
			funderLearners[file.FunderType] = map[string]bool{}
		}
		line.Files++
		line.AmountCents += file.AmountCents
		report.TotalAmountCents += file.AmountCents
		funderLearners[file.FunderType][file.LearnerID] = true
	}
	for funderType, line := range byFunder {
		line.Learners = len(funderLearners[funderType])
		report.ByFunder = append(report.ByFunder, *line)
	}
	sort.Slice(report.ByFunder, func(i, j int) bool { return report.ByFunder[i].FunderType < report.ByFunder[j].FunderType })
	report.TotalLearners = len(learners)
	report.TotalTrainedHours = float64(totalSeconds) / 3600.0
	return report, nil
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

const fundingColumns = `tenant_id::text, id::text, learner_id, cohort_id, funder_type, funder_name, reference, status, amount_cents, notes, created_at, updated_at, archived_at`

func scanFundingFile(row pgScanner) (core.FundingFile, error) {
	var f core.FundingFile
	if err := row.Scan(&f.TenantID, &f.ID, &f.LearnerID, &f.CohortID, &f.FunderType, &f.FunderName, &f.Reference, &f.Status, &f.AmountCents, &f.Notes, &f.CreatedAt, &f.UpdatedAt, &f.ArchivedAt); err != nil {
		return core.FundingFile{}, err
	}
	return f, nil
}

func (s *PostgresStore) CreateFundingFile(ctx context.Context, file core.FundingFile, actorUserID ...string) (core.FundingFile, error) {
	if file.Status == "" {
		file.Status = "EN_INSTRUCTION"
	}
	if err := validateFundingFile(file); err != nil {
		return core.FundingFile{}, err
	}
	now := time.Now().UTC()
	file.ID = ids.New()
	file.CreatedAt = now
	file.UpdatedAt = now
	err := s.withTenantTx(ctx, file.TenantID, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO funding_files (tenant_id, id, learner_id, cohort_id, funder_type, funder_name, reference, status, amount_cents, notes, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
		`, file.TenantID, file.ID, file.LearnerID, file.CohortID, file.FunderType, file.FunderName, file.Reference, file.Status, file.AmountCents, file.Notes, now); err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(file.TenantID, firstActor(actorUserID), "funding_file.create", "funding_file", file.ID, map[string]any{"learner_id": file.LearnerID, "funder_type": file.FunderType}, now))
	})
	if err != nil {
		return core.FundingFile{}, pgErr(err)
	}
	return file, nil
}

func (s *PostgresStore) ListFundingFiles(ctx context.Context, tenantID, learnerID string) ([]core.FundingFile, error) {
	var files []core.FundingFile
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		query := `SELECT ` + fundingColumns + ` FROM funding_files WHERE tenant_id = $1 AND archived_at IS NULL`
		args := []any{tenantID}
		if learnerID != "" {
			query += ` AND learner_id = $2`
			args = append(args, learnerID)
		}
		query += ` ORDER BY created_at DESC`
		rows, err := tx.Query(ctx, query, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			file, err := scanFundingFile(rows)
			if err != nil {
				return err
			}
			files = append(files, file)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, pgErr(err)
	}
	if files == nil {
		files = []core.FundingFile{}
	}
	return files, nil
}

func (s *PostgresStore) UpdateFundingFile(ctx context.Context, tenantID, fileID string, patch core.FundingFilePatch, actorUserID ...string) (core.FundingFile, error) {
	var updated core.FundingFile
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `SELECT `+fundingColumns+` FROM funding_files WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL`, tenantID, fileID)
		file, err := scanFundingFile(row)
		if err != nil {
			return err
		}
		file, err = applyFundingPatch(file, patch)
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		if _, err := tx.Exec(ctx, `
			UPDATE funding_files
			SET cohort_id = $3, funder_type = $4, funder_name = $5, reference = $6, status = $7, amount_cents = $8, notes = $9, updated_at = $10
			WHERE tenant_id = $1 AND id = $2
		`, tenantID, fileID, file.CohortID, file.FunderType, file.FunderName, file.Reference, file.Status, file.AmountCents, file.Notes, now); err != nil {
			return err
		}
		file.UpdatedAt = now
		updated = file
		return insertAdminAudit(ctx, tx, newAdminAuditLog(tenantID, firstActor(actorUserID), "funding_file.update", "funding_file", fileID, nil, now))
	})
	if err != nil {
		return core.FundingFile{}, pgErr(err)
	}
	return updated, nil
}

func (s *PostgresStore) ArchiveFundingFile(ctx context.Context, tenantID, fileID string, actorUserID ...string) (core.FundingFile, error) {
	var archived core.FundingFile
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		now := time.Now().UTC()
		row := tx.QueryRow(ctx, `
			UPDATE funding_files SET archived_at = $3, updated_at = $3
			WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL
			RETURNING `+fundingColumns, tenantID, fileID, now)
		var err error
		archived, err = scanFundingFile(row)
		if err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(tenantID, firstActor(actorUserID), "funding_file.archive", "funding_file", fileID, nil, now))
	})
	if err != nil {
		return core.FundingFile{}, pgErr(err)
	}
	return archived, nil
}

func (s *PostgresStore) BPFExport(ctx context.Context, tenantID string, year int) (core.BPFReport, error) {
	report := core.BPFReport{Year: year}
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM tenants WHERE id = $1)`, tenantID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("%w: tenant", core.ErrNotFound)
		}
		var totalSeconds int64
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(DISTINCT learner_id),
				COALESCE(SUM(LEAST(GREATEST(EXTRACT(EPOCH FROM (completed_at - started_at))::bigint - paused_seconds, 0), $3::bigint)), 0)::bigint
			FROM activities
			WHERE tenant_id = $1 AND started_at IS NOT NULL AND completed_at IS NOT NULL
				AND completed_at > started_at
				AND EXTRACT(YEAR FROM completed_at)::int = $2
		`, tenantID, year, int64(maxTrackedActivityDuration.Seconds())).Scan(&report.TotalLearners, &totalSeconds); err != nil {
			return err
		}
		report.TotalTrainedHours = float64(totalSeconds) / 3600.0
		rows, err := tx.Query(ctx, `
			SELECT funder_type, COUNT(*), COUNT(DISTINCT learner_id), COALESCE(SUM(amount_cents), 0)::bigint
			FROM funding_files
			WHERE tenant_id = $1 AND archived_at IS NULL AND EXTRACT(YEAR FROM created_at)::int = $2
			GROUP BY funder_type
			ORDER BY funder_type
		`, tenantID, year)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var line core.BPFFunderLine
			if err := rows.Scan(&line.FunderType, &line.Files, &line.Learners, &line.AmountCents); err != nil {
				return err
			}
			report.TotalAmountCents += line.AmountCents
			report.ByFunder = append(report.ByFunder, line)
		}
		return rows.Err()
	})
	if err != nil {
		return core.BPFReport{}, pgErr(err)
	}
	return report, nil
}
