package cache

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var ErrCacheMiss = errors.New("cache miss")

type Cache interface {
	Get(ctx context.Context, key string) ([]byte, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Delete(ctx context.Context, key string) error
}

type NoopCache struct{}

func (NoopCache) Get(context.Context, string) ([]byte, error)              { return nil, ErrCacheMiss }
func (NoopCache) Set(context.Context, string, []byte, time.Duration) error { return nil }
func (NoopCache) Delete(context.Context, string) error                     { return nil }

type RedisCache struct {
	address string
	db      string
}

func NewRedisCache(rawURL string) (*RedisCache, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	if parsed.Scheme != "redis" {
		return nil, fmt.Errorf("unsupported redis URL scheme %q", parsed.Scheme)
	}
	address := parsed.Host
	if !strings.Contains(address, ":") {
		address += ":6379"
	}
	db := strings.TrimPrefix(parsed.Path, "/")
	if db == "" {
		db = "0"
	}
	return &RedisCache{address: address, db: db}, nil
}

func (c *RedisCache) Get(ctx context.Context, key string) ([]byte, error) {
	conn, reader, err := c.conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	if err := writeCommand(conn, "GET", key); err != nil {
		return nil, err
	}
	return readBulk(reader)
}

func (c *RedisCache) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	conn, reader, err := c.conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	seconds := int(ttl.Seconds())
	if seconds <= 0 {
		seconds = 60
	}
	if err := writeCommand(conn, "SETEX", key, strconv.Itoa(seconds), string(value)); err != nil {
		return err
	}
	_, err = readSimple(reader)
	return err
}

func (c *RedisCache) Delete(ctx context.Context, key string) error {
	conn, reader, err := c.conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if err := writeCommand(conn, "DEL", key); err != nil {
		return err
	}
	_, err = readInteger(reader)
	return err
}

func (c *RedisCache) conn(ctx context.Context) (net.Conn, *bufio.Reader, error) {
	dialer := net.Dialer{Timeout: 2 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", c.address)
	if err != nil {
		return nil, nil, err
	}
	reader := bufio.NewReader(conn)
	if c.db != "0" {
		if err := writeCommand(conn, "SELECT", c.db); err != nil {
			conn.Close()
			return nil, nil, err
		}
		if _, err := readSimple(reader); err != nil {
			conn.Close()
			return nil, nil, err
		}
	}
	return conn, reader, nil
}

func writeCommand(w io.Writer, parts ...string) error {
	if _, err := fmt.Fprintf(w, "*%d\r\n", len(parts)); err != nil {
		return err
	}
	for _, part := range parts {
		if _, err := fmt.Fprintf(w, "$%d\r\n%s\r\n", len(part), part); err != nil {
			return err
		}
	}
	return nil
}

func readBulk(reader *bufio.Reader) ([]byte, error) {
	line, err := reader.ReadString('\n')
	if err != nil {
		return nil, err
	}
	if strings.HasPrefix(line, "$-1") {
		return nil, ErrCacheMiss
	}
	if !strings.HasPrefix(line, "$") {
		return nil, parseRedisError(line)
	}
	size, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(line, "$")))
	if err != nil {
		return nil, err
	}
	data := make([]byte, size+2)
	if _, err := io.ReadFull(reader, data); err != nil {
		return nil, err
	}
	return data[:size], nil
}

func readSimple(reader *bufio.Reader) (string, error) {
	line, err := reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(line, "+") {
		return "", parseRedisError(line)
	}
	return strings.TrimSpace(strings.TrimPrefix(line, "+")), nil
}

func readInteger(reader *bufio.Reader) (int, error) {
	line, err := reader.ReadString('\n')
	if err != nil {
		return 0, err
	}
	if !strings.HasPrefix(line, ":") {
		return 0, parseRedisError(line)
	}
	return strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(line, ":")))
}

func parseRedisError(line string) error {
	line = strings.TrimSpace(line)
	if strings.HasPrefix(line, "-") {
		return errors.New(strings.TrimPrefix(line, "-"))
	}
	return fmt.Errorf("unexpected redis response %q", line)
}
