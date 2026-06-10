package store

// B-17: ressources pédagogiques. Les octets restent côté store (bytea en
// Postgres) — les listes ne portent jamais le contenu, seul GetResourceContent
// le charge.

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

// MaxResourceBytes caps uploads: the store keeps bytes in the database, which
// is fine for course handouts, not for video masters.
const MaxResourceBytes = 20 << 20 // 20 MiB

func validateResource(resource core.Resource) error {
	if strings.TrimSpace(resource.Title) == "" {
		return fmt.Errorf("%w: resource title is required", core.ErrInvalidInput)
	}
	switch resource.Kind {
	case "LIEN":
		if !strings.HasPrefix(resource.URL, "http://") && !strings.HasPrefix(resource.URL, "https://") {
			return fmt.Errorf("%w: a LIEN resource requires an http(s) url", core.ErrInvalidInput)
		}
	case "FICHIER":
		if len(resource.Content) == 0 {
			return fmt.Errorf("%w: a FICHIER resource requires content", core.ErrInvalidInput)
		}
		if len(resource.Content) > MaxResourceBytes {
			return fmt.Errorf("%w: resource exceeds the %d MiB limit", core.ErrInvalidInput, MaxResourceBytes>>20)
		}
	default:
		return fmt.Errorf("%w: kind must be FICHIER or LIEN", core.ErrInvalidInput)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

func (s *MemoryStore) CreateResource(_ context.Context, resource core.Resource, actorUserID ...string) (core.Resource, error) {
	if err := validateResource(resource); err != nil {
		return core.Resource{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tenants[resource.TenantID]; !ok {
		return core.Resource{}, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	if resource.CohortID != "" {
		if _, ok := s.cohorts[key(resource.TenantID, resource.CohortID)]; !ok {
			return core.Resource{}, fmt.Errorf("%w: cohort", core.ErrNotFound)
		}
	}
	now := time.Now().UTC()
	resource.ID = ids.New()
	resource.SizeBytes = int64(len(resource.Content))
	resource.UploadedBy = firstActor(actorUserID)
	resource.CreatedAt = now
	resource.ArchivedAt = nil
	s.resources[key(resource.TenantID, resource.ID)] = resource
	s.recordAdminAuditLocked(resource.TenantID, resource.UploadedBy, "resource.create", "resource", resource.ID, map[string]any{"kind": resource.Kind, "cohort_id": resource.CohortID}, now)
	resource.Content = nil
	return resource, nil
}

// ListResources: staff see everything; learnerID narrows to the learner's
// cohorts + tenant-wide resources. Content bytes are never returned here.
func (s *MemoryStore) ListResources(_ context.Context, tenantID, learnerID string) ([]core.Resource, error) {
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
	resources := make([]core.Resource, 0)
	for _, resource := range s.resources {
		if resource.TenantID != tenantID || resource.ArchivedAt != nil {
			continue
		}
		if learnerID != "" && resource.CohortID != "" && !cohorts[resource.CohortID] {
			continue
		}
		resource.Content = nil
		resources = append(resources, resource)
	}
	sort.Slice(resources, func(i, j int) bool { return resources[i].CreatedAt.After(resources[j].CreatedAt) })
	return resources, nil
}

// GetResourceContent loads the resource WITH its bytes; learnerID applies the
// same scope rule as ListResources.
func (s *MemoryStore) GetResourceContent(_ context.Context, tenantID, resourceID, learnerID string) (core.Resource, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	resource, ok := s.resources[key(tenantID, resourceID)]
	if !ok || resource.ArchivedAt != nil {
		return core.Resource{}, fmt.Errorf("%w: resource", core.ErrNotFound)
	}
	if learnerID != "" && resource.CohortID != "" {
		enrolled := false
		for _, enrollment := range s.enrollments {
			if enrollment.TenantID == tenantID && enrollment.LearnerID == learnerID &&
				enrollment.CohortID == resource.CohortID && enrollment.Status == "ACTIVE" {
				enrolled = true
				break
			}
		}
		if !enrolled {
			return core.Resource{}, fmt.Errorf("%w: resource", core.ErrNotFound)
		}
	}
	return resource, nil
}

func (s *MemoryStore) ArchiveResource(_ context.Context, tenantID, resourceID string, actorUserID ...string) (core.Resource, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	resource, ok := s.resources[key(tenantID, resourceID)]
	if !ok || resource.ArchivedAt != nil {
		return core.Resource{}, fmt.Errorf("%w: resource", core.ErrNotFound)
	}
	now := time.Now().UTC()
	resource.ArchivedAt = &now
	s.resources[key(tenantID, resourceID)] = resource
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "resource.archive", "resource", resourceID, nil, now)
	resource.Content = nil
	return resource, nil
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

const resourceColumns = `tenant_id::text, id::text, cohort_id, title, description, kind, url, file_name, mime_type, size_bytes, uploaded_by, created_at, archived_at`

func scanResource(row pgScanner) (core.Resource, error) {
	var res core.Resource
	if err := row.Scan(&res.TenantID, &res.ID, &res.CohortID, &res.Title, &res.Description, &res.Kind, &res.URL, &res.FileName, &res.MimeType, &res.SizeBytes, &res.UploadedBy, &res.CreatedAt, &res.ArchivedAt); err != nil {
		return core.Resource{}, err
	}
	return res, nil
}

func (s *PostgresStore) CreateResource(ctx context.Context, resource core.Resource, actorUserID ...string) (core.Resource, error) {
	if err := validateResource(resource); err != nil {
		return core.Resource{}, err
	}
	now := time.Now().UTC()
	resource.ID = ids.New()
	resource.SizeBytes = int64(len(resource.Content))
	resource.UploadedBy = firstActor(actorUserID)
	resource.CreatedAt = now
	err := s.withTenantTx(ctx, resource.TenantID, func(tx pgx.Tx) error {
		if resource.CohortID != "" {
			var exists bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM cohorts WHERE tenant_id = $1 AND id = $2)`, resource.TenantID, resource.CohortID).Scan(&exists); err != nil {
				return err
			}
			if !exists {
				return fmt.Errorf("%w: cohort", core.ErrNotFound)
			}
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO resources (tenant_id, id, cohort_id, title, description, kind, url, file_name, mime_type, size_bytes, content, uploaded_by, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		`, resource.TenantID, resource.ID, resource.CohortID, resource.Title, resource.Description, resource.Kind, resource.URL, resource.FileName, resource.MimeType, resource.SizeBytes, resource.Content, resource.UploadedBy, now); err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(resource.TenantID, resource.UploadedBy, "resource.create", "resource", resource.ID, map[string]any{"kind": resource.Kind, "cohort_id": resource.CohortID}, now))
	})
	if err != nil {
		return core.Resource{}, pgErr(err)
	}
	resource.Content = nil
	return resource, nil
}

func (s *PostgresStore) ListResources(ctx context.Context, tenantID, learnerID string) ([]core.Resource, error) {
	var resources []core.Resource
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		query := `SELECT ` + resourceColumns + ` FROM resources WHERE tenant_id = $1 AND archived_at IS NULL`
		args := []any{tenantID}
		if learnerID != "" {
			query += ` AND (cohort_id = '' OR cohort_id IN (
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
			resource, err := scanResource(rows)
			if err != nil {
				return err
			}
			resources = append(resources, resource)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, pgErr(err)
	}
	if resources == nil {
		resources = []core.Resource{}
	}
	return resources, nil
}

func (s *PostgresStore) GetResourceContent(ctx context.Context, tenantID, resourceID, learnerID string) (core.Resource, error) {
	var resource core.Resource
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		query := `SELECT ` + resourceColumns + `, content FROM resources WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL`
		args := []any{tenantID, resourceID}
		if learnerID != "" {
			query += ` AND (cohort_id = '' OR cohort_id IN (
				SELECT cohort_id FROM cohort_enrollments
				WHERE tenant_id = $1 AND learner_id = $3 AND status = 'ACTIVE'))`
			args = append(args, learnerID)
		}
		row := tx.QueryRow(ctx, query, args...)
		return row.Scan(&resource.TenantID, &resource.ID, &resource.CohortID, &resource.Title, &resource.Description, &resource.Kind, &resource.URL, &resource.FileName, &resource.MimeType, &resource.SizeBytes, &resource.UploadedBy, &resource.CreatedAt, &resource.ArchivedAt, &resource.Content)
	})
	if err != nil {
		return core.Resource{}, pgErr(err)
	}
	return resource, nil
}

func (s *PostgresStore) ArchiveResource(ctx context.Context, tenantID, resourceID string, actorUserID ...string) (core.Resource, error) {
	var archived core.Resource
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		now := time.Now().UTC()
		row := tx.QueryRow(ctx, `
			UPDATE resources SET archived_at = $3
			WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL
			RETURNING `+resourceColumns, tenantID, resourceID, now)
		var err error
		archived, err = scanResource(row)
		if err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(tenantID, firstActor(actorUserID), "resource.archive", "resource", resourceID, nil, now))
	})
	if err != nil {
		return core.Resource{}, pgErr(err)
	}
	return archived, nil
}
