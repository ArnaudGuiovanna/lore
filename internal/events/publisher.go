package events

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"lore/internal/core"

	"github.com/nats-io/nats.go"
)

type OutboxStore interface {
	ListUnpublishedEvents(ctx context.Context, limit int) ([]core.Event, error)
	MarkEventPublished(ctx context.Context, tenantID, eventID string, now time.Time) (core.Event, error)
}

type NATSPublisher struct {
	url      string
	store    OutboxStore
	logger   *slog.Logger
	interval time.Duration
	limit    int
}

func NewNATSPublisher(url string, store OutboxStore, logger *slog.Logger) *NATSPublisher {
	if logger == nil {
		logger = slog.Default()
	}
	return &NATSPublisher{
		url:      url,
		store:    store,
		logger:   logger,
		interval: 2 * time.Second,
		limit:    100,
	}
}

func (p *NATSPublisher) Run(ctx context.Context) {
	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()
	for {
		p.drainOnce(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (p *NATSPublisher) drainOnce(ctx context.Context) {
	if p.url == "" || p.store == nil {
		return
	}
	nc, err := nats.Connect(p.url, nats.Name("LORE outbox publisher"), nats.Timeout(2*time.Second))
	if err != nil {
		p.logger.Warn("outbox publisher: nats connect failed", "err", err)
		return
	}
	defer nc.Close()
	js, err := nc.JetStream()
	if err != nil {
		p.logger.Warn("outbox publisher: jetstream unavailable", "err", err)
		return
	}
	if _, err := js.StreamInfo("LORE_EVENTS"); err != nil {
		if _, addErr := js.AddStream(&nats.StreamConfig{Name: "LORE_EVENTS", Subjects: []string{"lore.>"}, Storage: nats.FileStorage}); addErr != nil {
			p.logger.Warn("outbox publisher: stream setup failed", "err", addErr)
			return
		}
	}
	events, err := p.store.ListUnpublishedEvents(ctx, p.limit)
	if err != nil {
		p.logger.Warn("outbox publisher: list events failed", "err", err)
		return
	}
	for _, event := range events {
		if err := publishEvent(ctx, js, event); err != nil {
			p.logger.Warn("outbox publisher: publish failed", "event_id", event.ID, "err", err)
			continue
		}
		if _, err := p.store.MarkEventPublished(ctx, event.TenantID, event.ID, time.Now().UTC()); err != nil {
			p.logger.Warn("outbox publisher: mark published failed", "event_id", event.ID, "err", err)
		}
	}
}

func publishEvent(ctx context.Context, js nats.JetStreamContext, event core.Event) error {
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}
	subject := fmt.Sprintf("lore.%s.%s", sanitizeSubjectToken(event.TenantID), sanitizeSubjectToken(event.EventType))
	_, err = js.Publish(subject, data, nats.Context(ctx), nats.MsgId(event.ID))
	return err
}

func sanitizeSubjectToken(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "unknown"
	}
	value = strings.ReplaceAll(value, ".", "_")
	value = strings.ReplaceAll(value, " ", "_")
	return value
}
