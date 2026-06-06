package cache

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestNoopCacheMissesAndIgnoresWrites(t *testing.T) {
	c := NoopCache{}
	if err := c.Set(context.Background(), "k", []byte("v"), time.Second); err != nil {
		t.Fatalf("set: %v", err)
	}
	if _, err := c.Get(context.Background(), "k"); !errors.Is(err, ErrCacheMiss) {
		t.Fatalf("expected cache miss, got %v", err)
	}
	if err := c.Delete(context.Background(), "k"); err != nil {
		t.Fatalf("delete: %v", err)
	}
}

func TestNewRedisCacheParsesURL(t *testing.T) {
	c, err := NewRedisCache("redis://localhost:6380/2")
	if err != nil {
		t.Fatalf("parse redis URL: %v", err)
	}
	if c.address != "localhost:6380" || c.db != "2" {
		t.Fatalf("unexpected redis config: %+v", c)
	}
	if _, err := NewRedisCache("http://localhost"); err == nil {
		t.Fatalf("expected invalid scheme error")
	}
}
