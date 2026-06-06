package events

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"lore/internal/core"
)

func TestNATSPublisherNoopsWithoutURL(t *testing.T) {
	store := &fakeOutboxStore{events: []core.Event{{
		TenantID:  "tenant",
		ID:        "event-1",
		EventType: "InteractionRecorded",
	}}}
	publisher := NewNATSPublisher("", store, slog.Default())
	publisher.drainOnce(context.Background())
	if store.listCalls != 0 {
		t.Fatalf("expected no list calls without NATS URL, got %d", store.listCalls)
	}
}

type fakeOutboxStore struct {
	events    []core.Event
	listCalls int
	marked    []string
}

func (s *fakeOutboxStore) ListUnpublishedEvents(_ context.Context, _ int) ([]core.Event, error) {
	s.listCalls++
	return s.events, nil
}

func (s *fakeOutboxStore) MarkEventPublished(_ context.Context, _ string, eventID string, now time.Time) (core.Event, error) {
	s.marked = append(s.marked, eventID)
	for _, event := range s.events {
		if event.ID == eventID {
			event.PublishedAt = &now
			return event, nil
		}
	}
	return core.Event{}, nil
}
