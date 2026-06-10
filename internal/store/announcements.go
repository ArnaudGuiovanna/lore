package store

// B-18: cohort/tenant announcements — the minimal trainer→learners channel.

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

func (s *MemoryStore) CreateAnnouncement(_ context.Context, announcement core.Announcement, actorUserID ...string) (core.Announcement, error) {
	if strings.TrimSpace(announcement.Title) == "" {
		return core.Announcement{}, fmt.Errorf("%w: announcement title is required", core.ErrInvalidInput)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tenants[announcement.TenantID]; !ok {
		return core.Announcement{}, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	if announcement.CohortID != "" {
		if _, ok := s.cohorts[key(announcement.TenantID, announcement.CohortID)]; !ok {
			return core.Announcement{}, fmt.Errorf("%w: cohort", core.ErrNotFound)
		}
	}
	now := time.Now().UTC()
	announcement.ID = ids.New()
	announcement.CreatedBy = firstActor(actorUserID)
	announcement.CreatedAt = now
	announcement.ArchivedAt = nil
	s.announcements[key(announcement.TenantID, announcement.ID)] = announcement
	s.recordAdminAuditLocked(announcement.TenantID, announcement.CreatedBy, "announcement.create", "announcement", announcement.ID, map[string]any{"cohort_id": announcement.CohortID}, now)
	return announcement, nil
}

// ListAnnouncements: staff see everything; learnerID narrows to the learner's
// cohorts + tenant-wide messages.
func (s *MemoryStore) ListAnnouncements(_ context.Context, tenantID, learnerID string) ([]core.Announcement, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return nil, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	cohorts := map[string]bool{}
	if learnerID != "" {
		for _, enrollment := range s.enrollments {
			if enrollment.TenantID == tenantID && enrollment.LearnerID == learnerID && enrollment.Status == "ACTIVE" {
				cohorts[enrollment.CohortID] = true
			}
		}
	}
	announcements := make([]core.Announcement, 0)
	for _, announcement := range s.announcements {
		if announcement.TenantID != tenantID || announcement.ArchivedAt != nil {
			continue
		}
		if learnerID != "" && announcement.CohortID != "" && !cohorts[announcement.CohortID] {
			continue
		}
		announcements = append(announcements, announcement)
	}
	sort.Slice(announcements, func(i, j int) bool { return announcements[i].CreatedAt.After(announcements[j].CreatedAt) })
	return announcements, nil
}

func (s *MemoryStore) ArchiveAnnouncement(_ context.Context, tenantID, announcementID string, actorUserID ...string) (core.Announcement, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	announcement, ok := s.announcements[key(tenantID, announcementID)]
	if !ok || announcement.ArchivedAt != nil {
		return core.Announcement{}, fmt.Errorf("%w: announcement", core.ErrNotFound)
	}
	now := time.Now().UTC()
	announcement.ArchivedAt = &now
	s.announcements[key(tenantID, announcementID)] = announcement
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "announcement.archive", "announcement", announcementID, nil, now)
	return announcement, nil
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

const announcementColumns = `tenant_id::text, id::text, COALESCE(cohort_id, ''), title, body, created_by, created_at, archived_at`

func scanAnnouncement(row pgScanner) (core.Announcement, error) {
	var a core.Announcement
	if err := row.Scan(&a.TenantID, &a.ID, &a.CohortID, &a.Title, &a.Body, &a.CreatedBy, &a.CreatedAt, &a.ArchivedAt); err != nil {
		return core.Announcement{}, err
	}
	return a, nil
}

func (s *PostgresStore) CreateAnnouncement(ctx context.Context, announcement core.Announcement, actorUserID ...string) (core.Announcement, error) {
	if strings.TrimSpace(announcement.Title) == "" {
		return core.Announcement{}, fmt.Errorf("%w: announcement title is required", core.ErrInvalidInput)
	}
	now := time.Now().UTC()
	announcement.ID = ids.New()
	announcement.CreatedBy = firstActor(actorUserID)
	announcement.CreatedAt = now
	err := s.withTenantTx(ctx, announcement.TenantID, func(tx pgx.Tx) error {
		if announcement.CohortID != "" {
			var exists bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM cohorts WHERE tenant_id = $1 AND id = $2)`, announcement.TenantID, announcement.CohortID).Scan(&exists); err != nil {
				return err
			}
			if !exists {
				return fmt.Errorf("%w: cohort", core.ErrNotFound)
			}
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO announcements (tenant_id, id, cohort_id, title, body, created_by, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, announcement.TenantID, announcement.ID, nullable(announcement.CohortID), announcement.Title, announcement.Body, announcement.CreatedBy, now); err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(announcement.TenantID, announcement.CreatedBy, "announcement.create", "announcement", announcement.ID, map[string]any{"cohort_id": announcement.CohortID}, now))
	})
	if err != nil {
		return core.Announcement{}, pgErr(err)
	}
	return announcement, nil
}

func (s *PostgresStore) ListAnnouncements(ctx context.Context, tenantID, learnerID string) ([]core.Announcement, error) {
	var announcements []core.Announcement
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		query := `SELECT ` + announcementColumns + ` FROM announcements WHERE tenant_id = $1 AND archived_at IS NULL`
		args := []any{tenantID}
		if learnerID != "" {
			query += ` AND (cohort_id IS NULL OR cohort_id IN (
				SELECT cohort_id FROM cohort_enrollments
				WHERE tenant_id = $1 AND learner_id = $2 AND status = 'ACTIVE'))`
			args = append(args, learnerID)
		}
		query += ` ORDER BY created_at DESC`
		rows, err := tx.Query(ctx, query, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			announcement, err := scanAnnouncement(rows)
			if err != nil {
				return err
			}
			announcements = append(announcements, announcement)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, pgErr(err)
	}
	if announcements == nil {
		announcements = []core.Announcement{}
	}
	return announcements, nil
}

func (s *PostgresStore) ArchiveAnnouncement(ctx context.Context, tenantID, announcementID string, actorUserID ...string) (core.Announcement, error) {
	var announcement core.Announcement
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		now := time.Now().UTC()
		row := tx.QueryRow(ctx, `
			UPDATE announcements SET archived_at = $3
			WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL
			RETURNING `+announcementColumns, tenantID, announcementID, now)
		var err error
		announcement, err = scanAnnouncement(row)
		if err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(tenantID, firstActor(actorUserID), "announcement.archive", "announcement", announcementID, nil, now))
	})
	if err != nil {
		return core.Announcement{}, pgErr(err)
	}
	return announcement, nil
}
