package store

// B-20: abonnements webhook. Le secret n'est jamais resservi par l'API (champ
// json:"-") — il n'est montré qu'à la création, comme une clé d'API.

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"lore/internal/core"
	"lore/internal/ids"
)

// validateWebhookSubscription rejects obviously hostile URLs early; the real
// SSRF guard lives in the dispatcher's dialer (dial-time IP check, redirects
// refused) so DNS rebinding cannot route a delivery to internal services.
func validateWebhookSubscription(sub core.WebhookSubscription) error {
	parsed, err := url.Parse(sub.URL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
		return fmt.Errorf("%w: webhook url must be a valid http(s) URL", core.ErrInvalidInput)
	}
	if host := parsed.Hostname(); host == "localhost" || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") {
		return fmt.Errorf("%w: webhook url cannot target an internal host", core.ErrInvalidInput)
	}
	if ip := net.ParseIP(parsed.Hostname()); ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()) {
		return fmt.Errorf("%w: webhook url cannot target a private or loopback address", core.ErrInvalidInput)
	}
	if len(sub.Secret) < 16 {
		return fmt.Errorf("%w: webhook secret must be at least 16 bytes", core.ErrInvalidInput)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

func (s *MemoryStore) CreateWebhookSubscription(_ context.Context, sub core.WebhookSubscription, actorUserID ...string) (core.WebhookSubscription, error) {
	if err := validateWebhookSubscription(sub); err != nil {
		return core.WebhookSubscription{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tenants[sub.TenantID]; !ok {
		return core.WebhookSubscription{}, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	now := time.Now().UTC()
	sub.ID = ids.New()
	sub.Active = true
	sub.CreatedBy = firstActor(actorUserID)
	sub.CreatedAt = now
	sub.ArchivedAt = nil
	if sub.EventTypes == nil {
		sub.EventTypes = []string{}
	}
	s.webhookSubscriptions[key(sub.TenantID, sub.ID)] = sub
	s.recordAdminAuditLocked(sub.TenantID, sub.CreatedBy, "webhook.create", "webhook_subscription", sub.ID, map[string]any{"url": sub.URL}, now)
	return sub, nil
}

func (s *MemoryStore) ListWebhookSubscriptions(_ context.Context, tenantID string) ([]core.WebhookSubscription, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return nil, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	subs := make([]core.WebhookSubscription, 0)
	for _, sub := range s.webhookSubscriptions {
		if sub.TenantID == tenantID && sub.ArchivedAt == nil {
			subs = append(subs, sub)
		}
	}
	sort.Slice(subs, func(i, j int) bool { return subs[i].CreatedAt.After(subs[j].CreatedAt) })
	return subs, nil
}

// ListActiveWebhookSubscriptionsForEvent is the dispatcher read: active subs
// of the tenant whose filter is empty or includes eventType.
func (s *MemoryStore) ListActiveWebhookSubscriptionsForEvent(_ context.Context, tenantID, eventType string) ([]core.WebhookSubscription, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	subs := make([]core.WebhookSubscription, 0)
	for _, sub := range s.webhookSubscriptions {
		if sub.TenantID != tenantID || sub.ArchivedAt != nil || !sub.Active {
			continue
		}
		if len(sub.EventTypes) > 0 && !containsString(sub.EventTypes, eventType) {
			continue
		}
		subs = append(subs, sub)
	}
	sort.Slice(subs, func(i, j int) bool { return subs[i].CreatedAt.Before(subs[j].CreatedAt) })
	return subs, nil
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func (s *MemoryStore) ArchiveWebhookSubscription(_ context.Context, tenantID, subscriptionID string, actorUserID ...string) (core.WebhookSubscription, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sub, ok := s.webhookSubscriptions[key(tenantID, subscriptionID)]
	if !ok || sub.ArchivedAt != nil {
		return core.WebhookSubscription{}, fmt.Errorf("%w: webhook subscription", core.ErrNotFound)
	}
	now := time.Now().UTC()
	sub.ArchivedAt = &now
	sub.Active = false
	s.webhookSubscriptions[key(tenantID, subscriptionID)] = sub
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "webhook.archive", "webhook_subscription", subscriptionID, nil, now)
	return sub, nil
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

const webhookColumns = `tenant_id::text, id::text, url, secret, event_types, active, created_by, created_at, archived_at`

func scanWebhookSubscription(row pgScanner) (core.WebhookSubscription, error) {
	var sub core.WebhookSubscription
	var eventTypes []byte
	if err := row.Scan(&sub.TenantID, &sub.ID, &sub.URL, &sub.Secret, &eventTypes, &sub.Active, &sub.CreatedBy, &sub.CreatedAt, &sub.ArchivedAt); err != nil {
		return core.WebhookSubscription{}, err
	}
	sub.EventTypes = decodeStrings(eventTypes)
	return sub, nil
}

func (s *PostgresStore) CreateWebhookSubscription(ctx context.Context, sub core.WebhookSubscription, actorUserID ...string) (core.WebhookSubscription, error) {
	if err := validateWebhookSubscription(sub); err != nil {
		return core.WebhookSubscription{}, err
	}
	now := time.Now().UTC()
	sub.ID = ids.New()
	sub.Active = true
	sub.CreatedBy = firstActor(actorUserID)
	sub.CreatedAt = now
	if sub.EventTypes == nil {
		sub.EventTypes = []string{}
	}
	err := s.withTenantTx(ctx, sub.TenantID, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO webhook_subscriptions (tenant_id, id, url, secret, event_types, active, created_by, created_at)
			VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7)
		`, sub.TenantID, sub.ID, sub.URL, sub.Secret, mustJSON(sub.EventTypes), sub.CreatedBy, now); err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(sub.TenantID, sub.CreatedBy, "webhook.create", "webhook_subscription", sub.ID, map[string]any{"url": sub.URL}, now))
	})
	if err != nil {
		return core.WebhookSubscription{}, pgErr(err)
	}
	return sub, nil
}

func (s *PostgresStore) ListWebhookSubscriptions(ctx context.Context, tenantID string) ([]core.WebhookSubscription, error) {
	var subs []core.WebhookSubscription
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT `+webhookColumns+` FROM webhook_subscriptions WHERE tenant_id = $1 AND archived_at IS NULL ORDER BY created_at DESC`, tenantID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			sub, err := scanWebhookSubscription(rows)
			if err != nil {
				return err
			}
			subs = append(subs, sub)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, pgErr(err)
	}
	if subs == nil {
		subs = []core.WebhookSubscription{}
	}
	return subs, nil
}

func (s *PostgresStore) ListActiveWebhookSubscriptionsForEvent(ctx context.Context, tenantID, eventType string) ([]core.WebhookSubscription, error) {
	var subs []core.WebhookSubscription
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT `+webhookColumns+` FROM webhook_subscriptions
			WHERE tenant_id = $1 AND archived_at IS NULL AND active
				AND (event_types = '[]'::jsonb OR event_types @> to_jsonb(ARRAY[$2::text]))
			ORDER BY created_at
		`, tenantID, eventType)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			sub, err := scanWebhookSubscription(rows)
			if err != nil {
				return err
			}
			subs = append(subs, sub)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, pgErr(err)
	}
	if subs == nil {
		subs = []core.WebhookSubscription{}
	}
	return subs, nil
}

func (s *PostgresStore) ArchiveWebhookSubscription(ctx context.Context, tenantID, subscriptionID string, actorUserID ...string) (core.WebhookSubscription, error) {
	var archived core.WebhookSubscription
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		now := time.Now().UTC()
		row := tx.QueryRow(ctx, `
			UPDATE webhook_subscriptions SET archived_at = $3, active = FALSE
			WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL
			RETURNING `+webhookColumns, tenantID, subscriptionID, now)
		var err error
		archived, err = scanWebhookSubscription(row)
		if err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(tenantID, firstActor(actorUserID), "webhook.archive", "webhook_subscription", subscriptionID, nil, now))
	})
	if err != nil {
		return core.WebhookSubscription{}, pgErr(err)
	}
	return archived, nil
}
