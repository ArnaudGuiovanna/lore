package events

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
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

type fakeWebhookStore struct {
	fakeOutboxStore
	subs []core.WebhookSubscription
}

func (s *fakeWebhookStore) ListActiveWebhookSubscriptionsForEvent(_ context.Context, tenantID, eventType string) ([]core.WebhookSubscription, error) {
	var out []core.WebhookSubscription
	for _, sub := range s.subs {
		if sub.TenantID != tenantID || !sub.Active {
			continue
		}
		if len(sub.EventTypes) > 0 {
			match := false
			for _, t := range sub.EventTypes {
				if t == eventType {
					match = true
				}
			}
			if !match {
				continue
			}
		}
		out = append(out, sub)
	}
	return out, nil
}

func TestWebhookDispatcherSignsAndMarksPublished(t *testing.T) {
	var received []byte
	var signature, eventID string
	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		received = body
		signature = r.Header.Get("X-LORE-Signature")
		eventID = r.Header.Get("X-LORE-Event-ID")
		w.WriteHeader(http.StatusNoContent)
	}))
	defer receiver.Close()

	event := core.Event{TenantID: "t1", ID: "evt-1", EventType: "interaction.recorded", Payload: map[string]any{"k": "v"}}
	store := &fakeWebhookStore{
		fakeOutboxStore: fakeOutboxStore{events: []core.Event{event}},
		subs: []core.WebhookSubscription{{
			TenantID: "t1", ID: "sub-1", URL: receiver.URL, Secret: "secret-0123456789abcdef", Active: true,
		}},
	}
	dispatcher := NewWebhookDispatcher(store, nil).AllowPrivateNetworks()
	dispatcher.drainOnce(context.Background())

	if len(received) == 0 {
		t.Fatal("webhook endpoint never called")
	}
	if eventID != "evt-1" {
		t.Fatalf("event id header = %q", eventID)
	}
	want := "sha256=" + SignWebhookBody("secret-0123456789abcdef", received)
	if signature != want {
		t.Fatalf("signature = %q want %q", signature, want)
	}
	if len(store.marked) != 1 || store.marked[0] != "evt-1" {
		t.Fatalf("event not marked published: %+v", store.marked)
	}
}

func TestWebhookDispatcherKeepsEventOnFailure(t *testing.T) {
	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer receiver.Close()

	event := core.Event{TenantID: "t1", ID: "evt-2", EventType: "alert.created"}
	store := &fakeWebhookStore{
		fakeOutboxStore: fakeOutboxStore{events: []core.Event{event}},
		subs: []core.WebhookSubscription{{
			TenantID: "t1", ID: "sub-1", URL: receiver.URL, Secret: "secret-0123456789abcdef", Active: true,
		}},
	}
	dispatcher := NewWebhookDispatcher(store, nil).AllowPrivateNetworks()
	dispatcher.drainOnce(context.Background())
	if len(store.marked) != 0 {
		t.Fatalf("failed delivery must keep the event unpublished: %+v", store.marked)
	}
}

func TestWebhookDispatcherBlocksPrivateDestinations(t *testing.T) {
	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("SSRF guard let a loopback delivery through")
	}))
	defer receiver.Close()
	event := core.Event{TenantID: "t1", ID: "evt-3", EventType: "alert.created"}
	store := &fakeWebhookStore{
		fakeOutboxStore: fakeOutboxStore{events: []core.Event{event}},
		subs: []core.WebhookSubscription{{
			TenantID: "t1", ID: "sub-1", URL: receiver.URL, Secret: "secret-0123456789abcdef", Active: true,
		}},
	}
	// Default client (no AllowPrivateNetworks): loopback must be refused and
	// the event must stay unpublished.
	dispatcher := NewWebhookDispatcher(store, nil)
	dispatcher.drainOnce(context.Background())
	if len(store.marked) != 0 {
		t.Fatalf("event must remain unpublished when the destination is private: %+v", store.marked)
	}
}
