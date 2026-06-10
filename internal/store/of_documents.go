package store

// B-10: contractual OF documents with append-only versioning.

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

var documentKinds = map[string]bool{
	"CONVENTION": true, "CONTRAT": true, "DEVIS": true,
	"PROGRAMME": true, "REGLEMENT_INTERIEUR": true, "AUTRE": true,
}

func validateDocument(doc core.OFDocument) error {
	if !documentKinds[doc.Kind] {
		return fmt.Errorf("%w: kind must be CONVENTION, CONTRAT, DEVIS, PROGRAMME, REGLEMENT_INTERIEUR or AUTRE", core.ErrInvalidInput)
	}
	if strings.TrimSpace(doc.Title) == "" {
		return fmt.Errorf("%w: document title is required", core.ErrInvalidInput)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Memory store
// ---------------------------------------------------------------------------

func (s *MemoryStore) CreateDocument(_ context.Context, doc core.OFDocument, actorUserID ...string) (core.OFDocument, error) {
	if err := validateDocument(doc); err != nil {
		return core.OFDocument{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tenants[doc.TenantID]; !ok {
		return core.OFDocument{}, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	now := time.Now().UTC()
	doc.ID = ids.New()
	doc.RootID = doc.ID
	doc.Version = 1
	doc.CreatedBy = firstActor(actorUserID)
	doc.CreatedAt = now
	doc.ArchivedAt = nil
	s.documents[key(doc.TenantID, doc.ID)] = doc
	s.recordAdminAuditLocked(doc.TenantID, doc.CreatedBy, "document.create", "of_document", doc.ID, map[string]any{"kind": doc.Kind}, now)
	return doc, nil
}

// NewDocumentVersion appends a new version of the document identified by any
// version id of the chain; body/title default to the previous version.
func (s *MemoryStore) NewDocumentVersion(_ context.Context, tenantID, documentID, title, body string, actorUserID ...string) (core.OFDocument, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	previous, ok := s.documents[key(tenantID, documentID)]
	if !ok {
		return core.OFDocument{}, fmt.Errorf("%w: document", core.ErrNotFound)
	}
	latest := previous
	for _, doc := range s.documents {
		if doc.TenantID == tenantID && doc.RootID == previous.RootID && doc.Version > latest.Version {
			latest = doc
		}
	}
	next := latest
	next.ID = ids.New()
	next.Version = latest.Version + 1
	if strings.TrimSpace(title) != "" {
		next.Title = title
	}
	if body != "" {
		next.Body = body
	}
	now := time.Now().UTC()
	next.CreatedBy = firstActor(actorUserID)
	next.CreatedAt = now
	next.ArchivedAt = nil
	s.documents[key(tenantID, next.ID)] = next
	s.recordAdminAuditLocked(tenantID, next.CreatedBy, "document.version", "of_document", next.ID, map[string]any{"root_id": next.RootID, "version": next.Version}, now)
	return next, nil
}

// ListDocuments returns the LATEST version of each document chain, optionally
// filtered by learner (their own documents + their cohort's).
func (s *MemoryStore) ListDocuments(_ context.Context, tenantID, learnerID string) ([]core.OFDocument, error) {
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
	latestByRoot := map[string]core.OFDocument{}
	for _, doc := range s.documents {
		if doc.TenantID != tenantID || doc.ArchivedAt != nil {
			continue
		}
		if learnerID != "" {
			ownedByLearner := doc.LearnerID == learnerID
			ownedByCohort := doc.LearnerID == "" && doc.CohortID != "" && cohorts[doc.CohortID]
			tenantWide := doc.LearnerID == "" && doc.CohortID == ""
			if !ownedByLearner && !ownedByCohort && !tenantWide {
				continue
			}
		}
		if current, ok := latestByRoot[doc.RootID]; !ok || doc.Version > current.Version {
			latestByRoot[doc.RootID] = doc
		}
	}
	documents := make([]core.OFDocument, 0, len(latestByRoot))
	for _, doc := range latestByRoot {
		documents = append(documents, doc)
	}
	sort.Slice(documents, func(i, j int) bool { return documents[i].CreatedAt.After(documents[j].CreatedAt) })
	return documents, nil
}

func (s *MemoryStore) GetDocument(_ context.Context, tenantID, documentID string) (core.OFDocument, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	doc, ok := s.documents[key(tenantID, documentID)]
	if !ok {
		return core.OFDocument{}, fmt.Errorf("%w: document", core.ErrNotFound)
	}
	return doc, nil
}

func (s *MemoryStore) ArchiveDocument(_ context.Context, tenantID, documentID string, actorUserID ...string) (core.OFDocument, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	doc, ok := s.documents[key(tenantID, documentID)]
	if !ok || doc.ArchivedAt != nil {
		return core.OFDocument{}, fmt.Errorf("%w: document", core.ErrNotFound)
	}
	now := time.Now().UTC()
	doc.ArchivedAt = &now
	s.documents[key(tenantID, documentID)] = doc
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "document.archive", "of_document", documentID, nil, now)
	return doc, nil
}

// ---------------------------------------------------------------------------
// Postgres store
// ---------------------------------------------------------------------------

const documentColumns = `tenant_id::text, id::text, root_id::text, version, kind, title, body, COALESCE(cohort_id, ''), COALESCE(learner_id, ''), created_by, created_at, archived_at`

func scanDocument(row pgScanner) (core.OFDocument, error) {
	var doc core.OFDocument
	if err := row.Scan(&doc.TenantID, &doc.ID, &doc.RootID, &doc.Version, &doc.Kind, &doc.Title, &doc.Body, &doc.CohortID, &doc.LearnerID, &doc.CreatedBy, &doc.CreatedAt, &doc.ArchivedAt); err != nil {
		return core.OFDocument{}, err
	}
	return doc, nil
}

func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func (s *PostgresStore) CreateDocument(ctx context.Context, doc core.OFDocument, actorUserID ...string) (core.OFDocument, error) {
	if err := validateDocument(doc); err != nil {
		return core.OFDocument{}, err
	}
	now := time.Now().UTC()
	doc.ID = ids.New()
	doc.RootID = doc.ID
	doc.Version = 1
	doc.CreatedBy = firstActor(actorUserID)
	doc.CreatedAt = now
	err := s.withTenantTx(ctx, doc.TenantID, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO of_documents (tenant_id, id, root_id, version, kind, title, body, cohort_id, learner_id, created_by, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		`, doc.TenantID, doc.ID, doc.RootID, doc.Version, doc.Kind, doc.Title, doc.Body, nullable(doc.CohortID), nullable(doc.LearnerID), doc.CreatedBy, now); err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(doc.TenantID, doc.CreatedBy, "document.create", "of_document", doc.ID, map[string]any{"kind": doc.Kind}, now))
	})
	if err != nil {
		return core.OFDocument{}, pgErr(err)
	}
	return doc, nil
}

func (s *PostgresStore) NewDocumentVersion(ctx context.Context, tenantID, documentID, title, body string, actorUserID ...string) (core.OFDocument, error) {
	var next core.OFDocument
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `
			SELECT `+documentColumns+`
			FROM of_documents
			WHERE tenant_id = $1 AND root_id = (SELECT root_id FROM of_documents WHERE tenant_id = $1 AND id = $2)
			ORDER BY version DESC
			LIMIT 1
		`, tenantID, documentID)
		latest, err := scanDocument(row)
		if err != nil {
			return err
		}
		next = latest
		next.ID = ids.New()
		next.Version = latest.Version + 1
		if strings.TrimSpace(title) != "" {
			next.Title = title
		}
		if body != "" {
			next.Body = body
		}
		now := time.Now().UTC()
		next.CreatedBy = firstActor(actorUserID)
		next.CreatedAt = now
		next.ArchivedAt = nil
		if _, err := tx.Exec(ctx, `
			INSERT INTO of_documents (tenant_id, id, root_id, version, kind, title, body, cohort_id, learner_id, created_by, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		`, next.TenantID, next.ID, next.RootID, next.Version, next.Kind, next.Title, next.Body, nullable(next.CohortID), nullable(next.LearnerID), next.CreatedBy, now); err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(tenantID, next.CreatedBy, "document.version", "of_document", next.ID, map[string]any{"root_id": next.RootID, "version": next.Version}, now))
	})
	if err != nil {
		return core.OFDocument{}, pgErr(err)
	}
	return next, nil
}

func (s *PostgresStore) ListDocuments(ctx context.Context, tenantID, learnerID string) ([]core.OFDocument, error) {
	var documents []core.OFDocument
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		query := `
			SELECT DISTINCT ON (root_id) ` + documentColumns + `
			FROM of_documents
			WHERE tenant_id = $1 AND archived_at IS NULL`
		args := []any{tenantID}
		if learnerID != "" {
			query += `
			  AND (learner_id = $2
			    OR (learner_id IS NULL AND cohort_id IN (
			         SELECT cohort_id FROM cohort_enrollments
			         WHERE tenant_id = $1 AND learner_id = $2 AND status = 'ACTIVE'))
			    OR (learner_id IS NULL AND cohort_id IS NULL))`
			args = append(args, learnerID)
		}
		query += `
			ORDER BY root_id, version DESC`
		rows, err := tx.Query(ctx, query, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			doc, err := scanDocument(rows)
			if err != nil {
				return err
			}
			documents = append(documents, doc)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, pgErr(err)
	}
	sort.Slice(documents, func(i, j int) bool { return documents[i].CreatedAt.After(documents[j].CreatedAt) })
	if documents == nil {
		documents = []core.OFDocument{}
	}
	return documents, nil
}

func (s *PostgresStore) GetDocument(ctx context.Context, tenantID, documentID string) (core.OFDocument, error) {
	var doc core.OFDocument
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `SELECT `+documentColumns+` FROM of_documents WHERE tenant_id = $1 AND id = $2`, tenantID, documentID)
		var err error
		doc, err = scanDocument(row)
		return err
	})
	if err != nil {
		return core.OFDocument{}, pgErr(err)
	}
	return doc, nil
}

func (s *PostgresStore) ArchiveDocument(ctx context.Context, tenantID, documentID string, actorUserID ...string) (core.OFDocument, error) {
	var doc core.OFDocument
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		now := time.Now().UTC()
		row := tx.QueryRow(ctx, `
			UPDATE of_documents SET archived_at = $3
			WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL
			RETURNING `+documentColumns, tenantID, documentID, now)
		var err error
		doc, err = scanDocument(row)
		if err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(tenantID, firstActor(actorUserID), "document.archive", "of_document", documentID, nil, now))
	})
	if err != nil {
		return core.OFDocument{}, pgErr(err)
	}
	return doc, nil
}
