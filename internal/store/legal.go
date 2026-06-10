package store

// B-28: textes légaux versionnés + registre des consentements. Un consentement
// pointe la version exacte du texte accepté, ce qui le rend opposable.

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

var legalTextKinds = map[string]bool{"CGU": true, "CONFIDENTIALITE": true, "MENTIONS": true}

func validateLegalText(text core.LegalText) error {
	if !legalTextKinds[text.Kind] {
		return fmt.Errorf("%w: kind must be one of CGU, CONFIDENTIALITE, MENTIONS", core.ErrInvalidInput)
	}
	if strings.TrimSpace(text.Body) == "" {
		return fmt.Errorf("%w: body is required", core.ErrInvalidInput)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

func (s *MemoryStore) PublishLegalText(_ context.Context, text core.LegalText, actorUserID ...string) (core.LegalText, error) {
	if err := validateLegalText(text); err != nil {
		return core.LegalText{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tenants[text.TenantID]; !ok {
		return core.LegalText{}, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	version := 1
	for _, existing := range s.legalTexts {
		if existing.TenantID == text.TenantID && existing.Kind == text.Kind && existing.Version >= version {
			version = existing.Version + 1
		}
	}
	now := time.Now().UTC()
	text.ID = ids.New()
	text.Version = version
	text.PublishedBy = firstActor(actorUserID)
	text.PublishedAt = now
	s.legalTexts[key(text.TenantID, text.ID)] = text
	s.recordAdminAuditLocked(text.TenantID, text.PublishedBy, "legal_text.publish", "legal_text", text.ID, map[string]any{"kind": text.Kind, "version": version}, now)
	return text, nil
}

// ListLegalTexts: latest version per kind when history=false, full history
// otherwise (newest first).
func (s *MemoryStore) ListLegalTexts(_ context.Context, tenantID string, history bool) ([]core.LegalText, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return nil, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	texts := make([]core.LegalText, 0)
	for _, text := range s.legalTexts {
		if text.TenantID == tenantID {
			texts = append(texts, text)
		}
	}
	sort.Slice(texts, func(i, j int) bool {
		if texts[i].Kind != texts[j].Kind {
			return texts[i].Kind < texts[j].Kind
		}
		return texts[i].Version > texts[j].Version
	})
	if history {
		return texts, nil
	}
	latest := make([]core.LegalText, 0)
	seen := map[string]bool{}
	for _, text := range texts {
		if !seen[text.Kind] {
			seen[text.Kind] = true
			latest = append(latest, text)
		}
	}
	return latest, nil
}

// RecordConsent is idempotent per (user, legal text): re-consenting to the
// same version is a no-op that returns the existing record.
func (s *MemoryStore) RecordConsent(_ context.Context, tenantID, userID, legalTextID string) (core.Consent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	text, ok := s.legalTexts[key(tenantID, legalTextID)]
	if !ok {
		return core.Consent{}, fmt.Errorf("%w: legal text", core.ErrNotFound)
	}
	for _, consent := range s.consents {
		if consent.TenantID == tenantID && consent.UserID == userID && consent.LegalTextID == legalTextID {
			return consent, nil
		}
	}
	consent := core.Consent{
		TenantID:    tenantID,
		ID:          ids.New(),
		UserID:      userID,
		LegalTextID: legalTextID,
		Kind:        text.Kind,
		Version:     text.Version,
		ConsentedAt: time.Now().UTC(),
	}
	s.consents[key(tenantID, consent.ID)] = consent
	return consent, nil
}

// ListConsents: the tenant registre; userID narrows to one person.
func (s *MemoryStore) ListConsents(_ context.Context, tenantID, userID string) ([]core.Consent, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return nil, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	consents := make([]core.Consent, 0)
	for _, consent := range s.consents {
		if consent.TenantID != tenantID {
			continue
		}
		if userID != "" && consent.UserID != userID {
			continue
		}
		consents = append(consents, consent)
	}
	sort.Slice(consents, func(i, j int) bool { return consents[i].ConsentedAt.After(consents[j].ConsentedAt) })
	return consents, nil
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

const legalTextColumns = `tenant_id::text, id::text, kind, version, body, published_by, published_at`

func scanLegalText(row pgScanner) (core.LegalText, error) {
	var t core.LegalText
	if err := row.Scan(&t.TenantID, &t.ID, &t.Kind, &t.Version, &t.Body, &t.PublishedBy, &t.PublishedAt); err != nil {
		return core.LegalText{}, err
	}
	return t, nil
}

func (s *PostgresStore) PublishLegalText(ctx context.Context, text core.LegalText, actorUserID ...string) (core.LegalText, error) {
	if err := validateLegalText(text); err != nil {
		return core.LegalText{}, err
	}
	now := time.Now().UTC()
	text.ID = ids.New()
	text.PublishedBy = firstActor(actorUserID)
	text.PublishedAt = now
	err := s.withTenantTx(ctx, text.TenantID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE(MAX(version), 0) + 1 FROM legal_texts WHERE tenant_id = $1 AND kind = $2
		`, text.TenantID, text.Kind).Scan(&text.Version); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO legal_texts (tenant_id, id, kind, version, body, published_by, published_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, text.TenantID, text.ID, text.Kind, text.Version, text.Body, text.PublishedBy, now); err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(text.TenantID, text.PublishedBy, "legal_text.publish", "legal_text", text.ID, map[string]any{"kind": text.Kind, "version": text.Version}, now))
	})
	if err != nil {
		return core.LegalText{}, pgErr(err)
	}
	return text, nil
}

func (s *PostgresStore) ListLegalTexts(ctx context.Context, tenantID string, history bool) ([]core.LegalText, error) {
	var texts []core.LegalText
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		query := `SELECT ` + legalTextColumns + ` FROM legal_texts WHERE tenant_id = $1 ORDER BY kind, version DESC`
		if !history {
			query = `SELECT DISTINCT ON (kind) ` + legalTextColumns + ` FROM legal_texts WHERE tenant_id = $1 ORDER BY kind, version DESC`
		}
		rows, err := tx.Query(ctx, query, tenantID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			text, err := scanLegalText(rows)
			if err != nil {
				return err
			}
			texts = append(texts, text)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, pgErr(err)
	}
	if texts == nil {
		texts = []core.LegalText{}
	}
	return texts, nil
}

func (s *PostgresStore) RecordConsent(ctx context.Context, tenantID, userID, legalTextID string) (core.Consent, error) {
	var consent core.Consent
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `SELECT `+legalTextColumns+` FROM legal_texts WHERE tenant_id = $1 AND id = $2`, tenantID, legalTextID)
		text, err := scanLegalText(row)
		if err != nil {
			return err
		}
		consent = core.Consent{
			TenantID:    tenantID,
			ID:          ids.New(),
			UserID:      userID,
			LegalTextID: legalTextID,
			Kind:        text.Kind,
			Version:     text.Version,
			ConsentedAt: time.Now().UTC(),
		}
		// Idempotent: the unique (tenant, user, legal_text) constraint keeps the
		// first consent; re-consent returns the original row.
		row = tx.QueryRow(ctx, `
			INSERT INTO consents (tenant_id, id, user_id, legal_text_id, kind, version, consented_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (tenant_id, user_id, legal_text_id) DO UPDATE SET user_id = consents.user_id
			RETURNING tenant_id::text, id::text, user_id, legal_text_id, kind, version, consented_at
		`, tenantID, consent.ID, userID, legalTextID, consent.Kind, consent.Version, consent.ConsentedAt)
		return row.Scan(&consent.TenantID, &consent.ID, &consent.UserID, &consent.LegalTextID, &consent.Kind, &consent.Version, &consent.ConsentedAt)
	})
	if err != nil {
		return core.Consent{}, pgErr(err)
	}
	return consent, nil
}

func (s *PostgresStore) ListConsents(ctx context.Context, tenantID, userID string) ([]core.Consent, error) {
	var consents []core.Consent
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		query := `SELECT tenant_id::text, id::text, user_id, legal_text_id, kind, version, consented_at FROM consents WHERE tenant_id = $1`
		args := []any{tenantID}
		if userID != "" {
			query += ` AND user_id = $2`
			args = append(args, userID)
		}
		query += ` ORDER BY consented_at DESC`
		rows, err := tx.Query(ctx, query, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var consent core.Consent
			if err := rows.Scan(&consent.TenantID, &consent.ID, &consent.UserID, &consent.LegalTextID, &consent.Kind, &consent.Version, &consent.ConsentedAt); err != nil {
				return err
			}
			consents = append(consents, consent)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, pgErr(err)
	}
	if consents == nil {
		consents = []core.Consent{}
	}
	return consents, nil
}
