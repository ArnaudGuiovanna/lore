package main

import (
	"strings"
	"testing"

	"lore/internal/config"
	"lore/internal/httpapi"
)

func TestConfigureAuthAllowsOpenLocalMode(t *testing.T) {
	server := httpapi.NewServer(nil, nil, nil, "", "")
	err := configureAuth(server, config.Config{
		Environment:  "development",
		JWTAlgorithm: "HS256",
		JWTSecret:    "",
	})
	if err != nil {
		t.Fatalf("development open mode should be allowed: %v", err)
	}
}

func TestConfigureAuthRejectsMissingProductionJWTSecret(t *testing.T) {
	server := httpapi.NewServer(nil, nil, nil, "", "")
	err := configureAuth(server, config.Config{
		Environment:  "production",
		JWTAlgorithm: "HS256",
		JWTSecret:    "",
	})
	if err == nil || !strings.Contains(err.Error(), "JWT_SECRET") {
		t.Fatalf("expected production JWT_SECRET error, got %v", err)
	}
}

func TestConfigureAuthRejectsWeakProductionJWTSecret(t *testing.T) {
	server := httpapi.NewServer(nil, nil, nil, "", "")
	err := configureAuth(server, config.Config{
		Environment:  "production",
		JWTAlgorithm: "HS256",
		JWTSecret:    "too-short",
	})
	if err == nil || !strings.Contains(err.Error(), "at least 32 bytes") {
		t.Fatalf("expected weak secret error, got %v", err)
	}
}

func TestConfigureAuthAllowsStrongProductionJWTSecret(t *testing.T) {
	server := httpapi.NewServer(nil, nil, nil, "", "")
	err := configureAuth(server, config.Config{
		Environment:  "production",
		JWTAlgorithm: "HS256",
		JWTSecret:    "0123456789abcdef0123456789abcdef",
	})
	if err != nil {
		t.Fatalf("strong production JWT_SECRET should be allowed: %v", err)
	}
}

func TestConfigureMetricsAllowsOpenLocalMode(t *testing.T) {
	server := httpapi.NewServer(nil, nil, nil, "", "")
	err := configureMetrics(server, config.Config{
		Environment:  "development",
		MetricsToken: "",
	})
	if err != nil {
		t.Fatalf("development metrics without token should be allowed: %v", err)
	}
}

func TestConfigureMetricsRejectsMissingProductionToken(t *testing.T) {
	server := httpapi.NewServer(nil, nil, nil, "", "")
	err := configureMetrics(server, config.Config{
		Environment:  "production",
		MetricsToken: "",
	})
	if err == nil || !strings.Contains(err.Error(), "LORE_METRICS_TOKEN") {
		t.Fatalf("expected production metrics token error, got %v", err)
	}
}

func TestConfigureMetricsRejectsWeakProductionToken(t *testing.T) {
	server := httpapi.NewServer(nil, nil, nil, "", "")
	err := configureMetrics(server, config.Config{
		Environment:  "production",
		MetricsToken: "too-short",
	})
	if err == nil || !strings.Contains(err.Error(), "at least 32 bytes") {
		t.Fatalf("expected weak metrics token error, got %v", err)
	}
}

func TestConfigureMetricsAllowsStrongProductionToken(t *testing.T) {
	server := httpapi.NewServer(nil, nil, nil, "", "")
	err := configureMetrics(server, config.Config{
		Environment:  "production",
		MetricsToken: "0123456789abcdef0123456789abcdef",
	})
	if err != nil {
		t.Fatalf("strong production metrics token should be allowed: %v", err)
	}
}
