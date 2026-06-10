package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMigrationKeepsTenantUUIDAndHeadlessTextIDs(t *testing.T) {
	sqlBytes, err := os.ReadFile("../../db/migrations/000001_init.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(sqlBytes)
	for _, required := range []string{
		"tenant_id UUID NOT NULL",
		"id TEXT NOT NULL DEFAULT gen_random_uuid()::text",
		"learner_id TEXT NOT NULL",
		"concept_id TEXT NOT NULL",
		"aggregate_id TEXT NOT NULL",
		"CREATE TABLE idempotency_records",
		"status_code INTEGER NOT NULL DEFAULT 200",
		"schema_version INTEGER NOT NULL DEFAULT 1",
		"correlation_id TEXT NOT NULL DEFAULT ''",
		"dedupe_key TEXT NOT NULL",
		"recommended_action TEXT NOT NULL DEFAULT ''",
		"CREATE TABLE llm_configurations",
		"scope_type TEXT NOT NULL DEFAULT 'tenant'",
		"scope_id TEXT NOT NULL DEFAULT ''",
		"PRIMARY KEY (tenant_id, scope_type, scope_id)",
		"CHECK (scope_type IN ('tenant', 'program', 'cohort', 'learner'))",
		"api_key TEXT NOT NULL DEFAULT ''",
		"ALTER TABLE %I FORCE ROW LEVEL SECURITY",
		"current_setting(''app.tenant_id'', true)",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("migration missing required contract fragment: %s", required)
		}
	}
	for _, forbidden := range []string{
		"learner_id UUID",
		"concept_id UUID",
		"aggregate_id UUID",
		"owner_id UUID",
	} {
		if strings.Contains(sql, forbidden) {
			t.Fatalf("migration still contains forbidden UUID business id fragment: %s", forbidden)
		}
	}
}

func TestMigrationDirectoryIncludesAdminCRUDMigration(t *testing.T) {
	entries, err := os.ReadDir("../../db/migrations")
	if err != nil {
		t.Fatalf("read migrations dir: %v", err)
	}
	var names []string
	for _, entry := range entries {
		if !entry.IsDir() && filepath.Ext(entry.Name()) == ".sql" {
			names = append(names, entry.Name())
		}
	}
	joined := strings.Join(names, "\n")
	for _, required := range []string{"000001_init.sql", "000002_admin_crud.sql", "000003_activity_pause.sql", "000004_course_modules.sql", "000005_cohort_invites.sql", "000006_satisfaction.sql"} {
		if !strings.Contains(joined, required) {
			t.Fatalf("migration directory missing %s in %v", required, names)
		}
	}
}
