package llm

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestGuardedHTTPClientBlocksLoopback(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := GuardedHTTPClient(2 * time.Second)
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, server.URL, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if _, err := client.Do(req); err == nil {
		t.Fatal("expected guarded client to block a loopback request")
	}
}

func TestIsBlockedIPRanges(t *testing.T) {
	blocked := []string{
		"127.0.0.1",       // loopback
		"10.1.2.3",        // private
		"192.168.0.1",     // private
		"172.16.5.4",      // private
		"169.254.169.254", // link-local (cloud metadata)
		"0.0.0.0",         // unspecified
		"100.64.1.1",      // carrier-grade NAT
		"::1",             // IPv6 loopback
		"fe80::1",         // IPv6 link-local
	}
	for _, addr := range blocked {
		if ip := net.ParseIP(addr); ip == nil || !isBlockedIP(ip) {
			t.Errorf("expected %s to be blocked", addr)
		}
	}
	allowed := []string{"8.8.8.8", "1.1.1.1", "93.184.216.34"}
	for _, addr := range allowed {
		if !isBlockedIP(net.ParseIP(addr)) {
			continue
		}
		t.Errorf("expected %s to be allowed", addr)
	}
}

// TestGuardedHTTPClientDoesNotFollowRedirects ensures a redirect to an internal
// address is not transparently followed.
func TestGuardedHTTPClientDoesNotFollowRedirects(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Redirect(w, &http.Request{}, "http://169.254.169.254/latest/meta-data/", http.StatusFound)
	}))
	defer server.Close()

	// Point at the server via its public-looking client check is moot here; we
	// only assert the redirect itself is not auto-followed (status returned as-is).
	client := GuardedHTTPClient(2 * time.Second)
	// Replace the dial guard with the default so we can reach the loopback test
	// server, isolating the redirect behavior under test.
	client.Transport = &http.Transport{}
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, server.URL, nil)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 300 || resp.StatusCode >= 400 {
		t.Fatalf("expected redirect status to be returned unfollowed, got %d", resp.StatusCode)
	}
	if loc := resp.Header.Get("Location"); !strings.Contains(loc, "169.254.169.254") {
		t.Fatalf("unexpected redirect location: %q", loc)
	}
}
