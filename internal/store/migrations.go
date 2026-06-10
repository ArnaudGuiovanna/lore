package store

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func (s *PostgresStore) ApplyMigrationsPath(ctx context.Context, path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("stat migrations path %s: %w", path, err)
	}
	if !info.IsDir() {
		version := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
		return s.ApplyMigrationFile(ctx, version, path)
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return fmt.Errorf("read migrations dir %s: %w", path, err)
	}
	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".sql" {
			continue
		}
		files = append(files, entry.Name())
	}
	sort.Strings(files)
	for _, name := range files {
		fullPath := filepath.Join(path, name)
		version := strings.TrimSuffix(name, filepath.Ext(name))
		if err := s.ApplyMigrationFile(ctx, version, fullPath); err != nil {
			return err
		}
	}
	return nil
}

func (s *PostgresStore) ApplyMigrationFile(ctx context.Context, version, path string) error {
	sql, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read migration %s: %w", path, err)
	}
	return s.ApplyMigrationSQL(ctx, version, string(sql))
}

func (s *PostgresStore) ApplyMigrationSQL(ctx context.Context, version, sql string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`); err != nil {
		return err
	}
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`, version).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return tx.Commit(ctx)
	}
	if _, err := tx.Exec(ctx, sql); err != nil {
		return fmt.Errorf("apply migration %s: %w", version, err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, version); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
