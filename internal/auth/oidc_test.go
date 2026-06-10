package auth

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type fakeIdP struct {
	server *httptest.Server
	keys   map[string]*rsa.PrivateKey
}

func newFakeIdP(t *testing.T) *fakeIdP {
	t.Helper()
	idp := &fakeIdP{keys: map[string]*rsa.PrivateKey{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{
			"issuer":   idp.server.URL,
			"jwks_uri": idp.server.URL + "/jwks",
		})
	})
	mux.HandleFunc("GET /jwks", func(w http.ResponseWriter, r *http.Request) {
		var keys []map[string]string
		for kid, key := range idp.keys {
			keys = append(keys, map[string]string{
				"kty": "RSA", "use": "sig", "kid": kid,
				"n": base64.RawURLEncoding.EncodeToString(key.PublicKey.N.Bytes()),
				"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.PublicKey.E)).Bytes()),
			})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": keys})
	})
	idp.server = httptest.NewServer(mux)
	t.Cleanup(idp.server.Close)
	return idp
}

func (idp *fakeIdP) addKey(t *testing.T, kid string) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	idp.keys[kid] = key
	return key
}

func (idp *fakeIdP) issue(t *testing.T, key *rsa.PrivateKey, kid string, claims map[string]any) string {
	t.Helper()
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT", "kid": kid})
	payload, _ := json.Marshal(claims)
	input := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	digest := sha256.Sum256([]byte(input))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return input + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func baseClaims(idp *fakeIdP) map[string]any {
	return map[string]any{
		"sub": "user-1", "iss": idp.server.URL, "aud": "lore-api",
		"exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix(),
		"tenant_id": "tenant-1", "role": "LEARNER",
	}
}

func TestOIDCVerifyDiscoveryAndClaims(t *testing.T) {
	idp := newFakeIdP(t)
	key := idp.addKey(t, "kid-1")
	verifier := NewOIDCVerifier(idp.server.URL, "lore-api")

	claims, err := verifier.Verify(context.Background(), idp.issue(t, key, "kid-1", baseClaims(idp)))
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.Subject != "user-1" || claims.TenantID != "tenant-1" || claims.Role != "LEARNER" {
		t.Fatalf("claims mismatch: %+v", claims)
	}

	// aud as an array including ours is accepted.
	arr := baseClaims(idp)
	arr["aud"] = []string{"other", "lore-api"}
	if _, err := verifier.Verify(context.Background(), idp.issue(t, key, "kid-1", arr)); err != nil {
		t.Fatalf("array audience rejected: %v", err)
	}

	// Wrong audience, wrong issuer, expired, missing custom claims: rejected.
	bad := baseClaims(idp)
	bad["aud"] = "someone-else"
	if _, err := verifier.Verify(context.Background(), idp.issue(t, key, "kid-1", bad)); err == nil {
		t.Fatal("wrong audience accepted")
	}
	bad = baseClaims(idp)
	bad["iss"] = "https://evil.example"
	if _, err := verifier.Verify(context.Background(), idp.issue(t, key, "kid-1", bad)); err == nil {
		t.Fatal("wrong issuer accepted")
	}
	bad = baseClaims(idp)
	bad["exp"] = time.Now().Add(-time.Hour).Unix()
	if _, err := verifier.Verify(context.Background(), idp.issue(t, key, "kid-1", bad)); err == nil {
		t.Fatal("expired token accepted")
	}
	bad = baseClaims(idp)
	delete(bad, "tenant_id")
	if _, err := verifier.Verify(context.Background(), idp.issue(t, key, "kid-1", bad)); err == nil {
		t.Fatal("token without tenant_id accepted")
	}
}

func TestOIDCKeyRotation(t *testing.T) {
	idp := newFakeIdP(t)
	key1 := idp.addKey(t, "kid-1")
	verifier := NewOIDCVerifier(idp.server.URL, "lore-api")
	if _, err := verifier.Verify(context.Background(), idp.issue(t, key1, "kid-1", baseClaims(idp))); err != nil {
		t.Fatalf("initial verify: %v", err)
	}

	// Rotate: new key, new kid. The refresh is rate-limited, so move the clock.
	key2 := idp.addKey(t, "kid-2")
	verifier.now = func() time.Time { return time.Now().UTC().Add(2 * minKeyRefreshInterval) }
	if _, err := verifier.Verify(context.Background(), idp.issue(t, key2, "kid-2", baseClaims(idp))); err != nil {
		t.Fatalf("rotated key rejected: %v", err)
	}

	// A token signed with a key the IdP never published is rejected.
	rogue, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	verifier.now = func() time.Time { return time.Now().UTC().Add(4 * minKeyRefreshInterval) }
	if _, err := verifier.Verify(context.Background(), idp.issue(t, rogue, "kid-rogue", baseClaims(idp))); err == nil {
		t.Fatal("rogue key accepted")
	}
}
