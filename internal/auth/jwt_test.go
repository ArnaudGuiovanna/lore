package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"strings"
	"testing"
	"time"
)

func fixedClock() func() time.Time { return func() time.Time { return time.Unix(1000, 0).UTC() } }

func TestRS256IssueAndVerifyRoundTrip(t *testing.T) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	svc, err := NewRS256TokenService(priv, &priv.PublicKey)
	if err != nil {
		t.Fatalf("new rs256 service: %v", err)
	}
	svc.now = fixedClock()
	if svc.Algorithm() != AlgRS256 || !svc.CanIssue() {
		t.Fatalf("unexpected service state alg=%s canIssue=%v", svc.Algorithm(), svc.CanIssue())
	}
	token, err := svc.Issue("user-1", "tenant-1", "TRAINER", time.Hour)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	claims, err := svc.Verify(token)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.Subject != "user-1" || claims.TenantID != "tenant-1" || claims.Role != "TRAINER" {
		t.Fatalf("unexpected claims: %+v", claims)
	}
}

func TestRS256VerifyOnlyServiceCannotIssueButVerifiesExternalTokens(t *testing.T) {
	priv, _ := rsa.GenerateKey(rand.Reader, 2048)
	issuer, _ := NewRS256TokenService(priv, &priv.PublicKey)
	issuer.now = fixedClock()
	external, err := issuer.Issue("user-1", "tenant-1", "LEARNER", time.Hour)
	if err != nil {
		t.Fatalf("issuer issue: %v", err)
	}

	// A verify-only service (public key only) models the OIDC boundary.
	verifier, err := NewRS256TokenService(nil, &priv.PublicKey)
	if err != nil {
		t.Fatalf("new verify-only: %v", err)
	}
	verifier.now = fixedClock()
	if verifier.CanIssue() {
		t.Fatal("verify-only service must not be able to issue")
	}
	if _, err := verifier.Issue("u", "t", "LEARNER", time.Hour); !errors.Is(err, ErrIssuanceDisabled) {
		t.Fatalf("expected ErrIssuanceDisabled, got %v", err)
	}
	claims, err := verifier.Verify(external)
	if err != nil {
		t.Fatalf("verify external token: %v", err)
	}
	if claims.Subject != "user-1" {
		t.Fatalf("unexpected external claims: %+v", claims)
	}
}

func TestAlgorithmConfusionIsRejected(t *testing.T) {
	priv, _ := rsa.GenerateKey(rand.Reader, 2048)
	rs, _ := NewRS256TokenService(priv, &priv.PublicKey)
	rs.now = fixedClock()
	hs := NewTokenService("secret")
	hs.now = fixedClock()

	rsToken, _ := rs.Issue("u", "t", "TRAINER", time.Hour)
	hsToken, _ := hs.Issue("u", "t", "TRAINER", time.Hour)

	if _, err := rs.Verify(hsToken); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("RS256 service must reject an HS256 token, got %v", err)
	}
	if _, err := hs.Verify(rsToken); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("HS256 service must reject an RS256 token, got %v", err)
	}
}

func TestRS256FromPEMRoundTrip(t *testing.T) {
	priv, _ := rsa.GenerateKey(rand.Reader, 2048)
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(priv)})
	pubDER, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		t.Fatalf("marshal public: %v", err)
	}
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER})

	svc, err := NewRS256TokenServiceFromPEM(privPEM, pubPEM)
	if err != nil {
		t.Fatalf("from PEM: %v", err)
	}
	svc.now = fixedClock()
	token, err := svc.Issue("user-1", "tenant-1", "TENANT_ADMIN", time.Hour)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, err := svc.Verify(token); err != nil {
		t.Fatalf("verify: %v", err)
	}
}

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
