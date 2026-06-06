package auth

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestTokenServiceIssuesAndVerifies(t *testing.T) {
	service := NewTokenService("secret")
	service.now = func() time.Time { return time.Unix(1000, 0).UTC() }
	token, err := service.Issue("user-1", "tenant-1", "TRAINER", time.Hour)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	claims, err := service.Verify(token)
	if err != nil {
		t.Fatalf("verify token: %v", err)
	}
	if claims.Subject != "user-1" || claims.TenantID != "tenant-1" || claims.Role != "TRAINER" {
		t.Fatalf("unexpected claims: %+v", claims)
	}
}

func TestTokenServiceRejectsTamperedAndExpiredTokens(t *testing.T) {
	service := NewTokenService("secret")
	service.now = func() time.Time { return time.Unix(1000, 0).UTC() }
	token, err := service.Issue("user-1", "tenant-1", "TRAINER", time.Second)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	tampered := token[:len(token)-1] + "x"
	if _, err := service.Verify(tampered); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("tampered token error=%v", err)
	}
	service.now = func() time.Time { return time.Unix(1002, 0).UTC() }
	if _, err := service.Verify(token); !errors.Is(err, ErrExpiredToken) {
		t.Fatalf("expired token error=%v", err)
	}
	if _, err := service.Verify(strings.Replace(token, ".", "", 1)); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("malformed token error=%v", err)
	}
}
