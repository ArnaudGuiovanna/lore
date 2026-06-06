package observability_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"lore/internal/observability"
)

func TestSetupTracingNoOpWithoutEndpoint(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	shutdown, err := observability.SetupTracing(context.Background(), "lore-test")
	if err != nil {
		t.Fatalf("setup tracing: %v", err)
	}
	if shutdown == nil {
		t.Fatal("shutdown function must never be nil")
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatalf("no-op shutdown should not error: %v", err)
	}
}

func TestMetricsInstrumentRecordsRequests(t *testing.T) {
	m := observability.NewMetrics()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ping", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	})
	handler := m.Instrument(mux, mux)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/ping", nil))
	if rec.Code != http.StatusTeapot {
		t.Fatalf("status passthrough failed: got %d", rec.Code)
	}

	scrape := httptest.NewRecorder()
	m.Handler().ServeHTTP(scrape, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	body := scrape.Body.String()
	if !strings.Contains(body, `lore_http_requests_total{method="GET",route="GET /ping",status="418"}`) {
		t.Fatalf("expected request counter with bounded route + status label, got:\n%s", body)
	}
}
