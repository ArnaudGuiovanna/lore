package store

// B-14: backend RGPD erasure. Deletes every runtime trace tied to one learner
// in one tenant — states, review cards, activities, instructions, generated
// content, interactions, evaluations, misconceptions, snapshots, alerts,
// learner-scoped LLM config, enrollments and outbox events that reference the
// learner. The user row itself is anonymized (tombstone keeps referential
// integrity for audit), and the erasure is recorded in the admin audit log
// WITHOUT any personal payload.

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"lore/internal/core"
)

// ---------------------------------------------------------------------------
// Memory store
// ---------------------------------------------------------------------------

func (s *MemoryStore) EraseLearnerData(_ context.Context, tenantID, learnerID string, actorUserID ...string) (map[string]int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tenants[tenantID]; !ok {
		return nil, fmt.Errorf("%w: tenant", core.ErrNotFound)
	}
	counts := map[string]int{}
	for k, v := range s.states {
		if v.TenantID == tenantID && v.LearnerID == learnerID {
			delete(s.states, k)
			counts["learner_states"]++
		}
	}
	// Collect instruction ids first so generated content can follow.
	instructionIDs := map[string]bool{}
	for k, v := range s.instructions {
		if v.TenantID == tenantID && v.LearnerID == learnerID {
			instructionIDs[v.ID] = true
			delete(s.instructions, k)
			counts["tutor_instructions"]++
		}
	}
	for k, v := range s.contents {
		if v.TenantID == tenantID && instructionIDs[v.InstructionID] {
			delete(s.contents, k)
			counts["generated_contents"]++
		}
	}
	for k, v := range s.activities {
		if v.TenantID == tenantID && v.LearnerID == learnerID {
			delete(s.activities, k)
			counts["activities"]++
		}
	}
	interactionIDs := map[string]bool{}
	for k, v := range s.interactions {
		if v.TenantID == tenantID && v.LearnerID == learnerID {
			interactionIDs[v.ID] = true
			delete(s.interactions, k)
			counts["interactions"]++
		}
	}
	for k, v := range s.evaluations {
		if v.TenantID == tenantID && interactionIDs[v.InteractionID] {
			delete(s.evaluations, k)
			counts["evaluations"]++
		}
	}
	for k, v := range s.misconceptions {
		if v.TenantID == tenantID && v.LearnerID == learnerID {
			delete(s.misconceptions, k)
			counts["misconceptions"]++
		}
	}
	for k, v := range s.snapshots {
		if v.TenantID == tenantID && v.LearnerID == learnerID {
			delete(s.snapshots, k)
			counts["pedagogical_snapshots"]++
		}
	}
	for k, v := range s.alerts {
		if v.TenantID == tenantID && v.LearnerID == learnerID {
			delete(s.alerts, k)
			counts["alerts"]++
		}
	}
	for k := range s.alertDedupe {
		if strings.Contains(k, learnerID) {
			delete(s.alertDedupe, k)
		}
	}
	for k, v := range s.llmConfigs {
		if v.TenantID == tenantID && v.ScopeType == "learner" && v.ScopeID == learnerID {
			delete(s.llmConfigs, k)
			counts["llm_configurations"]++
		}
	}
	for k, v := range s.enrollments {
		if v.TenantID == tenantID && v.LearnerID == learnerID {
			delete(s.enrollments, k)
			counts["cohort_enrollments"]++
		}
	}
	for k, v := range s.events {
		if v.TenantID != tenantID {
			continue
		}
		if learnerRef, ok := v.Payload["learner_id"].(string); ok && learnerRef == learnerID {
			delete(s.events, k)
			counts["event_outbox"]++
			continue
		}
		if v.AggregateType == "learner" && v.AggregateID == learnerID {
			delete(s.events, k)
			counts["event_outbox"]++
		}
	}
	// Tombstone the user row (cross-tenant identity): anonymize, do not delete.
	if user, ok := s.users[learnerID]; ok {
		user.Email = "anonymized-" + learnerID + "@redacted.invalid"
		user.Name = "Utilisateur supprimé (RGPD)"
		s.users[learnerID] = user
		counts["users_anonymized"] = 1
	}
	for k, v := range s.memberships {
		if v.TenantID == tenantID && v.UserID == learnerID {
			v.Status = "ARCHIVED"
			s.memberships[k] = v
			counts["memberships_archived"]++
		}
	}
	now := time.Now().UTC()
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "rgpd.erase", "learner", learnerID, map[string]any{"counts": counts}, now)
	return counts, nil
}

// ---------------------------------------------------------------------------
// Postgres store
// ---------------------------------------------------------------------------

func (s *PostgresStore) EraseLearnerData(ctx context.Context, tenantID, learnerID string, actorUserID ...string) (map[string]int, error) {
	counts := map[string]int{}
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		exec := func(label, sql string, args ...any) error {
			tag, err := tx.Exec(ctx, sql, args...)
			if err != nil {
				return fmt.Errorf("erase %s: %w", label, err)
			}
			if n := int(tag.RowsAffected()); n > 0 {
				counts[label] = n
			}
			return nil
		}
		// Children before parents (FK order).
		if err := exec("evaluations", `
			DELETE FROM evaluations e USING interactions i
			WHERE e.tenant_id = $1 AND i.tenant_id = $1 AND e.interaction_id = i.id AND i.learner_id = $2
		`, tenantID, learnerID); err != nil {
			return err
		}
		if err := exec("interactions", `DELETE FROM interactions WHERE tenant_id = $1 AND learner_id = $2`, tenantID, learnerID); err != nil {
			return err
		}
		if err := exec("generated_contents", `
			DELETE FROM generated_contents g USING tutor_instructions ti
			WHERE g.tenant_id = $1 AND ti.tenant_id = $1 AND g.instruction_id = ti.id AND ti.learner_id = $2
		`, tenantID, learnerID); err != nil {
			return err
		}
		if err := exec("pedagogical_snapshots", `DELETE FROM pedagogical_snapshots WHERE tenant_id = $1 AND learner_id = $2`, tenantID, learnerID); err != nil {
			return err
		}
		if err := exec("misconceptions", `DELETE FROM misconceptions WHERE tenant_id = $1 AND learner_id = $2`, tenantID, learnerID); err != nil {
			return err
		}
		if err := exec("alerts", `DELETE FROM alerts WHERE tenant_id = $1 AND learner_id = $2`, tenantID, learnerID); err != nil {
			return err
		}
		if err := exec("tutor_instructions", `DELETE FROM tutor_instructions WHERE tenant_id = $1 AND learner_id = $2`, tenantID, learnerID); err != nil {
			return err
		}
		if err := exec("activities", `DELETE FROM activities WHERE tenant_id = $1 AND learner_id = $2`, tenantID, learnerID); err != nil {
			return err
		}
		if err := exec("review_cards", `DELETE FROM review_cards WHERE tenant_id = $1 AND learner_id = $2`, tenantID, learnerID); err != nil {
			return err
		}
		if err := exec("learner_states", `DELETE FROM learner_states WHERE tenant_id = $1 AND learner_id = $2`, tenantID, learnerID); err != nil {
			return err
		}
		if err := exec("llm_configurations", `DELETE FROM llm_configurations WHERE tenant_id = $1 AND scope_type = 'learner' AND scope_id = $2`, tenantID, learnerID); err != nil {
			return err
		}
		if err := exec("cohort_enrollments", `DELETE FROM cohort_enrollments WHERE tenant_id = $1 AND learner_id = $2`, tenantID, learnerID); err != nil {
			return err
		}
		if err := exec("event_outbox", `
			DELETE FROM event_outbox
			WHERE tenant_id = $1
			  AND (payload_json->>'learner_id' = $2 OR (aggregate_type = 'learner' AND aggregate_id = $2) OR actor_user_id = $2)
		`, tenantID, learnerID); err != nil {
			return err
		}
		if err := exec("memberships_archived", `
			UPDATE memberships SET status = 'ARCHIVED', archived_at = now(), updated_at = now()
			WHERE tenant_id = $1 AND user_id = $2 AND status <> 'ARCHIVED'
		`, tenantID, learnerID); err != nil {
			return err
		}
		now := time.Now().UTC()
		return insertAdminAudit(ctx, tx, newAdminAuditLog(tenantID, firstActor(actorUserID), "rgpd.erase", "learner", learnerID, map[string]any{"counts": counts}, now))
	})
	if err != nil {
		return nil, pgErr(err)
	}
	// The user row lives OUTSIDE tenant RLS (cross-tenant identity): anonymize
	// it only when no other tenant still has an active membership.
	var active int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM memberships WHERE user_id = $1 AND status = 'ACTIVE'`, learnerID).Scan(&active); err == nil && active == 0 {
		tag, err := s.pool.Exec(ctx, `
			UPDATE users
			SET email = 'anonymized-' || id || '@redacted.invalid', name = 'Utilisateur supprimé (RGPD)'
			WHERE id = $1
		`, learnerID)
		if err == nil && tag.RowsAffected() > 0 {
			counts["users_anonymized"] = int(tag.RowsAffected())
		}
	}
	return counts, nil
}
