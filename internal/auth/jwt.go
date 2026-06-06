package auth

import (
	"crypto"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrInvalidToken     = errors.New("invalid token")
	ErrExpiredToken     = errors.New("expired token")
	ErrIssuanceDisabled = errors.New("token issuance is not available: no signing key configured")
	ErrUnsupportedKey   = errors.New("unsupported or unparable key material")
)

// Algorithm is the JWT signing algorithm a TokenService is configured for.
type Algorithm string

const (
	AlgHS256 Algorithm = "HS256"
	AlgRS256 Algorithm = "RS256"
)

type Claims struct {
	Subject  string `json:"sub"`
	TenantID string `json:"tenant_id"`
	Role     string `json:"role"`
	IssuedAt int64  `json:"iat"`
	Expires  int64  `json:"exp"`
}

// TokenService issues and verifies JWTs. It supports symmetric HS256 (shared
// secret) and asymmetric RS256 (RSA key pair). With RS256, a verify-only service
// can be created from just a public key, which is the integration boundary for
// externally-issued (e.g. OIDC) tokens.
type TokenService struct {
	alg        Algorithm
	secret     []byte          // HS256
	privateKey *rsa.PrivateKey // RS256 signing (optional; verify-only when nil)
	publicKey  *rsa.PublicKey  // RS256 verification
	now        func() time.Time
}

func nowUTC() func() time.Time { return func() time.Time { return time.Now().UTC() } }

// NewTokenService creates an HS256 service from a shared secret.
func NewTokenService(secret string) *TokenService {
	return &TokenService{alg: AlgHS256, secret: []byte(secret), now: nowUTC()}
}

// NewRS256TokenService creates an asymmetric service. privateKey may be nil for a
// verify-only service (the public key is then required).
func NewRS256TokenService(privateKey *rsa.PrivateKey, publicKey *rsa.PublicKey) (*TokenService, error) {
	if publicKey == nil && privateKey == nil {
		return nil, fmt.Errorf("%w: RS256 requires at least a public key", ErrUnsupportedKey)
	}
	if publicKey == nil {
		publicKey = &privateKey.PublicKey
	}
	return &TokenService{alg: AlgRS256, privateKey: privateKey, publicKey: publicKey, now: nowUTC()}, nil
}

// NewRS256TokenServiceFromPEM builds an RS256 service from PEM-encoded keys. An
// empty privatePEM yields a verify-only service.
func NewRS256TokenServiceFromPEM(privatePEM, publicPEM []byte) (*TokenService, error) {
	var priv *rsa.PrivateKey
	var pub *rsa.PublicKey
	var err error
	if len(privatePEM) > 0 {
		if priv, err = ParseRSAPrivateKeyPEM(privatePEM); err != nil {
			return nil, err
		}
	}
	if len(publicPEM) > 0 {
		if pub, err = ParseRSAPublicKeyPEM(publicPEM); err != nil {
			return nil, err
		}
	}
	return NewRS256TokenService(priv, pub)
}

// Algorithm reports the configured signing algorithm.
func (s *TokenService) Algorithm() Algorithm { return s.alg }

// CanIssue reports whether this service holds a signing key.
func (s *TokenService) CanIssue() bool {
	switch s.alg {
	case AlgHS256:
		return len(s.secret) > 0
	case AlgRS256:
		return s.privateKey != nil
	default:
		return false
	}
}

func (s *TokenService) Issue(subject, tenantID, role string, ttl time.Duration) (string, error) {
	if !s.CanIssue() {
		return "", ErrIssuanceDisabled
	}
	now := s.now()
	if ttl <= 0 {
		ttl = 8 * time.Hour
	}
	claims := Claims{
		Subject:  subject,
		TenantID: tenantID,
		Role:     role,
		IssuedAt: now.Unix(),
		Expires:  now.Add(ttl).Unix(),
	}
	header := map[string]string{"alg": string(s.alg), "typ": "JWT"}
	headerPart, err := encodeJSON(header)
	if err != nil {
		return "", err
	}
	claimsPart, err := encodeJSON(claims)
	if err != nil {
		return "", err
	}
	signingInput := headerPart + "." + claimsPart
	signature, err := s.sign(signingInput)
	if err != nil {
		return "", err
	}
	return signingInput + "." + signature, nil
}

func (s *TokenService) Verify(token string) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Claims{}, ErrInvalidToken
	}
	// Enforce the configured algorithm from the header to prevent algorithm
	// confusion (e.g. an HS256 token forged with the RSA public key as the HMAC
	// secret against a server that expects RS256).
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return Claims{}, ErrInvalidToken
	}
	var header struct {
		Alg string `json:"alg"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return Claims{}, ErrInvalidToken
	}
	if header.Alg != string(s.alg) {
		return Claims{}, ErrInvalidToken
	}

	signingInput := parts[0] + "." + parts[1]
	if err := s.verifySignature(signingInput, parts[2]); err != nil {
		return Claims{}, err
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Claims{}, ErrInvalidToken
	}
	var claims Claims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return Claims{}, ErrInvalidToken
	}
	if claims.Expires <= s.now().Unix() {
		return Claims{}, ErrExpiredToken
	}
	return claims, nil
}

func (s *TokenService) sign(input string) (string, error) {
	switch s.alg {
	case AlgHS256:
		mac := hmac.New(sha256.New, s.secret)
		_, _ = mac.Write([]byte(input))
		return base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
	case AlgRS256:
		digest := sha256.Sum256([]byte(input))
		sig, err := rsa.SignPKCS1v15(rand.Reader, s.privateKey, crypto.SHA256, digest[:])
		if err != nil {
			return "", err
		}
		return base64.RawURLEncoding.EncodeToString(sig), nil
	default:
		return "", ErrUnsupportedKey
	}
}

func (s *TokenService) verifySignature(input, signature string) error {
	switch s.alg {
	case AlgHS256:
		expected, err := s.sign(input)
		if err != nil {
			return ErrInvalidToken
		}
		if !hmac.Equal([]byte(signature), []byte(expected)) {
			return ErrInvalidToken
		}
		return nil
	case AlgRS256:
		sig, err := base64.RawURLEncoding.DecodeString(signature)
		if err != nil {
			return ErrInvalidToken
		}
		digest := sha256.Sum256([]byte(input))
		if err := rsa.VerifyPKCS1v15(s.publicKey, crypto.SHA256, digest[:], sig); err != nil {
			return ErrInvalidToken
		}
		return nil
	default:
		return ErrInvalidToken
	}
}

// ParseRSAPrivateKeyPEM parses a PKCS#1 or PKCS#8 RSA private key.
func ParseRSAPrivateKeyPEM(data []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("%w: no PEM block in private key", ErrUnsupportedKey)
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnsupportedKey, err)
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("%w: not an RSA private key", ErrUnsupportedKey)
	}
	return key, nil
}

// ParseRSAPublicKeyPEM parses a PKIX or PKCS#1 RSA public key.
func ParseRSAPublicKeyPEM(data []byte) (*rsa.PublicKey, error) {
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("%w: no PEM block in public key", ErrUnsupportedKey)
	}
	if parsed, err := x509.ParsePKIXPublicKey(block.Bytes); err == nil {
		key, ok := parsed.(*rsa.PublicKey)
		if !ok {
			return nil, fmt.Errorf("%w: not an RSA public key", ErrUnsupportedKey)
		}
		return key, nil
	}
	key, err := x509.ParsePKCS1PublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnsupportedKey, err)
	}
	return key, nil
}

func encodeJSON(v any) (string, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}
