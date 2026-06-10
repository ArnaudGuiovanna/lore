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
	"errors"
	"fmt"
	"log/slog"
	"net"
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
		client:   newSafeWebhookClient(false),
		interval: 2 * time.Second,
		limit:    100,
	}
}

// AllowPrivateNetworks disables the SSRF dial guard — for tests and for
// on-prem deployments whose receiver legitimately lives on a private network.
func (d *WebhookDispatcher) AllowPrivateNetworks() *WebhookDispatcher {
	d.client = newSafeWebhookClient(true)
	return d
}

var errPrivateAddress = errors.New("webhook destination resolves to a private, loopback or link-local address")

// newSafeWebhookClient builds the delivery client. The SSRF guard runs at
// DIAL time (not at subscription validation) so DNS rebinding cannot bypass
// it, and redirects are refused outright — a 302 must not steer a delivery
// into the metadata range after the initial check.
func newSafeWebhookClient(allowPrivate bool) *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			if !allowPrivate {
				host, _, err := net.SplitHostPort(addr)
				if err != nil {
					return nil, err
				}
				ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
				if err != nil {
					return nil, err
				}
				for _, ip := range ips {
					if isForbiddenWebhookIP(ip) {
						return nil, errPrivateAddress
					}
				}
			}
			return dialer.DialContext(ctx, network, addr)
		},
	}
	return &http.Client{
		Timeout:   10 * time.Second,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return fmt.Errorf("webhook deliveries do not follow redirects")
		},
	}
}

func isForbiddenWebhookIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast()
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
