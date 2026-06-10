package events

// B-20: livraison de webhooks signés depuis l'outbox. Chaque événement est
// POSTé en JSON à chaque abonnement actif du tenant qui matche son type, avec
// une signature HMAC-SHA256 du corps (X-LORE-Signature: sha256=<hex>).
// L'événement n'est marqué publié que si TOUTES les livraisons répondent 2xx :
// sémantique at-least-once, le récepteur déduplique sur X-LORE-Event-ID.
// N'activer qu'un seul draineur d'outbox (NATS ou webhooks) : ils partagent le
// même curseur published_at.

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"lore/internal/core"
)

type WebhookStore interface {
	OutboxStore
	ListActiveWebhookSubscriptionsForEvent(ctx context.Context, tenantID, eventType string) ([]core.WebhookSubscription, error)
}

type WebhookDispatcher struct {
	store    WebhookStore
	logger   *slog.Logger
	client   *http.Client
	interval time.Duration
	limit    int
}

func NewWebhookDispatcher(store WebhookStore, logger *slog.Logger) *WebhookDispatcher {
	if logger == nil {
		logger = slog.Default()
	}
	return &WebhookDispatcher{
		store:    store,
		logger:   logger,
		client:   &http.Client{Timeout: 10 * time.Second},
		interval: 2 * time.Second,
		limit:    100,
	}
}

func (d *WebhookDispatcher) Run(ctx context.Context) {
	ticker := time.NewTicker(d.interval)
	defer ticker.Stop()
	for {
		d.drainOnce(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (d *WebhookDispatcher) drainOnce(ctx context.Context) {
	if d.store == nil {
		return
	}
	pending, err := d.store.ListUnpublishedEvents(ctx, d.limit)
	if err != nil {
		d.logger.Warn("webhook outbox read failed", "err", err)
		return
	}
	for _, event := range pending {
		subs, err := d.store.ListActiveWebhookSubscriptionsForEvent(ctx, event.TenantID, event.EventType)
		if err != nil {
			d.logger.Warn("webhook subscription read failed", "tenant_id", event.TenantID, "err", err)
			continue
		}
		allDelivered := true
		for _, sub := range subs {
			if err := d.deliver(ctx, sub, event); err != nil {
				allDelivered = false
				d.logger.Warn("webhook delivery failed", "subscription_id", sub.ID, "event_id", event.ID, "err", err)
			}
		}
		if allDelivered {
			if _, err := d.store.MarkEventPublished(ctx, event.TenantID, event.ID, time.Now().UTC()); err != nil {
				d.logger.Warn("webhook publish mark failed", "event_id", event.ID, "err", err)
			}
		}
	}
}

func (d *WebhookDispatcher) deliver(ctx context.Context, sub core.WebhookSubscription, event core.Event) error {
	body, err := json.Marshal(event)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sub.URL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-LORE-Signature", "sha256="+SignWebhookBody(sub.Secret, body))
	req.Header.Set("X-LORE-Event-ID", event.ID)
	req.Header.Set("X-LORE-Event-Type", event.EventType)
	req.Header.Set("X-LORE-Tenant-ID", event.TenantID)
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("endpoint returned %d", resp.StatusCode)
	}
	return nil
}

// SignWebhookBody computes the hex HMAC-SHA256 the receiver must recompute to
// authenticate a delivery.
func SignWebhookBody(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}
