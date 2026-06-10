package auth

// B-20: OIDC complet côté vérification — discovery, JWKS avec rotation des
// clés (re-fetch sur kid inconnu), validation iss/aud/exp. LORE reste
// resource-server : l'IdP émet, LORE vérifie. Contrat de claims : l'IdP doit
// poser `tenant_id` et `role` (claims custom) en plus de `sub`.

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

var (
	ErrOIDCDiscovery = errors.New("oidc discovery failed")
	ErrOIDCClaims    = errors.New("oidc claims rejected")
)

// minKeyRefreshInterval rate-limits JWKS re-fetches triggered by unknown kids
// so a flood of forged tokens cannot hammer the IdP.
const minKeyRefreshInterval = time.Minute

type OIDCVerifier struct {
	issuer   string
	audience string
	client   *http.Client
	now      func() time.Time

	mu        sync.Mutex
	jwksURI   string
	keys      map[string]*rsa.PublicKey
	lastFetch time.Time
}

// NewOIDCVerifier builds a verifier for tokens issued by `issuer` with
// audience `audience`. Discovery and key fetching are lazy: the first Verify
// triggers them, and an unknown kid triggers a (rate-limited) refresh, which
// is how key rotation is absorbed.
func NewOIDCVerifier(issuer, audience string) *OIDCVerifier {
	return &OIDCVerifier{
		issuer:   strings.TrimRight(issuer, "/"),
		audience: audience,
		client:   &http.Client{Timeout: 10 * time.Second},
		now:      func() time.Time { return time.Now().UTC() },
	}
}

// oidcAudience accepts both the string and array JSON forms of `aud`.
type oidcAudience []string

func (a *oidcAudience) UnmarshalJSON(data []byte) error {
	var single string
	if err := json.Unmarshal(data, &single); err == nil {
		*a = oidcAudience{single}
		return nil
	}
	var many []string
	if err := json.Unmarshal(data, &many); err != nil {
		return err
	}
	*a = oidcAudience(many)
	return nil
}

func (v *OIDCVerifier) Verify(ctx context.Context, token string) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Claims{}, ErrInvalidToken
	}
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return Claims{}, ErrInvalidToken
	}
	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return Claims{}, ErrInvalidToken
	}
	if header.Alg != string(AlgRS256) {
		return Claims{}, ErrInvalidToken
	}
	key, err := v.keyForKid(ctx, header.Kid)
	if err != nil {
		return Claims{}, err
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return Claims{}, ErrInvalidToken
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], sig); err != nil {
		return Claims{}, ErrInvalidToken
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Claims{}, ErrInvalidToken
	}
	var body struct {
		Subject  string       `json:"sub"`
		Issuer   string       `json:"iss"`
		Audience oidcAudience `json:"aud"`
		Expires  int64        `json:"exp"`
		IssuedAt int64        `json:"iat"`
		TenantID string       `json:"tenant_id"`
		Role     string       `json:"role"`
	}
	if err := json.Unmarshal(payload, &body); err != nil {
		return Claims{}, ErrInvalidToken
	}
	if body.Expires <= v.now().Unix() {
		return Claims{}, ErrExpiredToken
	}
	if strings.TrimRight(body.Issuer, "/") != v.issuer {
		return Claims{}, fmt.Errorf("%w: issuer %q is not the configured issuer", ErrOIDCClaims, body.Issuer)
	}
	audOK := false
	for _, aud := range body.Audience {
		if aud == v.audience {
			audOK = true
			break
		}
	}
	if !audOK {
		return Claims{}, fmt.Errorf("%w: audience does not include %q", ErrOIDCClaims, v.audience)
	}
	if body.Subject == "" || body.TenantID == "" || body.Role == "" {
		return Claims{}, fmt.Errorf("%w: sub, tenant_id and role claims are required", ErrOIDCClaims)
	}
	return Claims{
		Subject:  body.Subject,
		TenantID: body.TenantID,
		Role:     body.Role,
		IssuedAt: body.IssuedAt,
		Expires:  body.Expires,
	}, nil
}

// keyForKid returns the RSA key for kid, fetching discovery/JWKS lazily and
// refreshing (rate-limited) when the kid is unknown — key rotation support.
func (v *OIDCVerifier) keyForKid(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if key, ok := v.keys[kid]; ok {
		return key, nil
	}
	if !v.lastFetch.IsZero() && v.now().Sub(v.lastFetch) < minKeyRefreshInterval {
		return nil, ErrInvalidToken
	}
	if v.jwksURI == "" {
		if err := v.discoverLocked(ctx); err != nil {
			return nil, err
		}
	}
	if err := v.refreshKeysLocked(ctx); err != nil {
		return nil, err
	}
	if key, ok := v.keys[kid]; ok {
		return key, nil
	}
	return nil, ErrInvalidToken
}

func (v *OIDCVerifier) discoverLocked(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.issuer+"/.well-known/openid-configuration", nil)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrOIDCDiscovery, err)
	}
	resp, err := v.client.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrOIDCDiscovery, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: discovery endpoint returned %d", ErrOIDCDiscovery, resp.StatusCode)
	}
	var doc struct {
		Issuer  string `json:"issuer"`
		JWKSURI string `json:"jwks_uri"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return fmt.Errorf("%w: %v", ErrOIDCDiscovery, err)
	}
	if strings.TrimRight(doc.Issuer, "/") != v.issuer {
		return fmt.Errorf("%w: discovery document issuer %q does not match %q", ErrOIDCDiscovery, doc.Issuer, v.issuer)
	}
	if doc.JWKSURI == "" {
		return fmt.Errorf("%w: discovery document has no jwks_uri", ErrOIDCDiscovery)
	}
	v.jwksURI = doc.JWKSURI
	return nil
}

func (v *OIDCVerifier) refreshKeysLocked(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.jwksURI, nil)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrOIDCDiscovery, err)
	}
	resp, err := v.client.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrOIDCDiscovery, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: jwks endpoint returned %d", ErrOIDCDiscovery, resp.StatusCode)
	}
	var jwks struct {
		Keys []struct {
			Kty string `json:"kty"`
			Use string `json:"use"`
			Kid string `json:"kid"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return fmt.Errorf("%w: %v", ErrOIDCDiscovery, err)
	}
	keys := map[string]*rsa.PublicKey{}
	for _, jwk := range jwks.Keys {
		if jwk.Kty != "RSA" || (jwk.Use != "" && jwk.Use != "sig") {
			continue
		}
		nBytes, err := base64.RawURLEncoding.DecodeString(jwk.N)
		if err != nil {
			continue
		}
		eBytes, err := base64.RawURLEncoding.DecodeString(jwk.E)
		if err != nil {
			continue
		}
		keys[jwk.Kid] = &rsa.PublicKey{
			N: new(big.Int).SetBytes(nBytes),
			E: int(new(big.Int).SetBytes(eBytes).Int64()),
		}
	}
	if len(keys) == 0 {
		return fmt.Errorf("%w: jwks document holds no usable RSA signing key", ErrOIDCDiscovery)
	}
	v.keys = keys
	v.lastFetch = v.now()
	return nil
}
