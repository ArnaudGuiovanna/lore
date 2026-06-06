package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrExpiredToken = errors.New("expired token")
)

type Claims struct {
	Subject  string `json:"sub"`
	TenantID string `json:"tenant_id"`
	Role     string `json:"role"`
	IssuedAt int64  `json:"iat"`
	Expires  int64  `json:"exp"`
}

type TokenService struct {
	secret []byte
	now    func() time.Time
}

func NewTokenService(secret string) *TokenService {
	return &TokenService{secret: []byte(secret), now: func() time.Time { return time.Now().UTC() }}
}

func (s *TokenService) Issue(subject, tenantID, role string, ttl time.Duration) (string, error) {
	if len(s.secret) == 0 {
		return "", fmt.Errorf("jwt secret is required")
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
	header := map[string]string{"alg": "HS256", "typ": "JWT"}
	headerPart, err := encodeJSON(header)
	if err != nil {
		return "", err
	}
	claimsPart, err := encodeJSON(claims)
	if err != nil {
		return "", err
	}
	signingInput := headerPart + "." + claimsPart
	return signingInput + "." + s.sign(signingInput), nil
}

func (s *TokenService) Verify(token string) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Claims{}, ErrInvalidToken
	}
	signingInput := parts[0] + "." + parts[1]
	if !hmac.Equal([]byte(parts[2]), []byte(s.sign(signingInput))) {
		return Claims{}, ErrInvalidToken
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

func (s *TokenService) sign(input string) string {
	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write([]byte(input))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func encodeJSON(v any) (string, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}
