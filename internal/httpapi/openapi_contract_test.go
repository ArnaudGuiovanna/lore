package httpapi_test

import (
	"os"
	"strings"
	"testing"
)

func TestOpenAPIContainsHeadlessRoutes(t *testing.T) {
	data, err := os.ReadFile("../../api/openapi.yaml")
	if err != nil {
		t.Fatalf("read openapi: %v", err)
	}
	doc := string(data)
	for _, path := range []string{
		"/v1/auth/token",
		"/v1/tenants/{tenant_id}/domains",
		"/v1/tenants/{tenant_id}/domains/{domain_id}/graph",
		"/v1/tenants/{tenant_id}/learners/{learner_id}/activities/next",
		"/v1/tenants/{tenant_id}/interactions",
		"/v1/tenants/{tenant_id}/learners/{learner_id}/assessments/plan",
		"/v1/tenants/{tenant_id}/assessments/{activity_id}/submit",
		"/v1/tenants/{tenant_id}/learners/{learner_id}/reviews/due",
		"/v1/tenants/{tenant_id}/tutor-instructions/{instruction_id}/generate",
		"/v1/tenants/{tenant_id}/generated-content",
		"/v1/tenants/{tenant_id}/generated-content/{content_id}",
		"/v1/tenants/{tenant_id}/events/outbox",
		"/v1/tenants/{tenant_id}/analytics/cohorts/{cohort_id}",
		"/v1/tenants/{tenant_id}/alerts",
	} {
		if !strings.Contains(doc, path+":") {
			t.Fatalf("OpenAPI missing path %s", path)
		}
	}
	for _, fragment := range []string{
		"bearerAuth:",
		"TenantID:",
		"RuntimeDecision:",
		"TutorInstruction:",
		"StateDelta:",
		"Misconception:",
		"LLMConfiguration:",
		"LLMScopeType:",
		"scope_type:",
		"scope_id:",
		"IdempotencyKey:",
		"X-LORE-Idempotent-Replay:",
		"schema_version:",
		"correlation_id:",
	} {
		if !strings.Contains(doc, fragment) {
			t.Fatalf("OpenAPI missing fragment %s", fragment)
		}
	}
}
