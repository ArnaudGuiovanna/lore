package store

// B-23: self-enrollment invite codes. The code is the bearer secret, so the
// lookup path works without tenant context (the public landing page resolves
// a code before any session exists). Redemption bookkeeping (use counter)
// lives here; membership + enrollment reuse the existing upsert methods.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"lore/internal/core"
	"lore/internal/ids"
)

// newInviteCode returns a 128-bit URL-safe secret.
func newInviteCode() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand failure is unrecoverable for secret generation.
		panic(fmt.Errorf("invite code entropy: %w", err))
	}
	return hex.EncodeToString(buf)
}

// inviteUsable reports why an invite cannot be redeemed (nil = usable).
func inviteUsable(invite core.CohortInvite, now time.Time) error {
	if invite.RevokedAt != nil {
		return fmt.Errorf("%w: invite revoked", core.ErrInvalidInput)
	}
	if invite.ExpiresAt != nil && now.After(*invite.ExpiresAt) {
		return fmt.Errorf("%w: invite expired", core.ErrInvalidInput)
	}
	if invite.MaxUses > 0 && invite.UseCount >= invite.MaxUses {
		return fmt.Errorf("%w: invite already used the maximum number of times", core.ErrInvalidInput)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Memory store
// ---------------------------------------------------------------------------

func (s *MemoryStore) CreateCohortInvite(_ context.Context, tenantID, cohortID string, expiresAt *time.Time, maxUses int, actorUserID ...string) (core.CohortInvite, error) {
	if maxUses < 0 {
		return core.CohortInvite{}, fmt.Errorf("%w: max_uses must be >= 0", core.ErrInvalidInput)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.cohorts[key(tenantID, cohortID)]; !ok {
		return core.CohortInvite{}, fmt.Errorf("%w: cohort", core.ErrNotFound)
	}
	now := time.Now().UTC()
	invite := core.CohortInvite{
		TenantID:  tenantID,
		ID:        ids.New(),
		CohortID:  cohortID,
		Code:      newInviteCode(),
		ExpiresAt: expiresAt,
		MaxUses:   maxUses,
		CreatedBy: firstActor(actorUserID),
		CreatedAt: now,
	}
	s.invites[invite.Code] = invite
	s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "cohort_invite.create", "cohort_invite", invite.ID, map[string]any{"cohort_id": cohortID}, now)
	return invite, nil
}

func (s *MemoryStore) ListCohortInvites(_ context.Context, tenantID, cohortID string) ([]core.CohortInvite, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.cohorts[key(tenantID, cohortID)]; !ok {
		return nil, fmt.Errorf("%w: cohort", core.ErrNotFound)
	}
	invites := make([]core.CohortInvite, 0)
	for _, invite := range s.invites {
		if invite.TenantID == tenantID && invite.CohortID == cohortID {
			invites = append(invites, invite)
		}
	}
	sort.Slice(invites, func(i, j int) bool { return invites[i].CreatedAt.After(invites[j].CreatedAt) })
	return invites, nil
}

func (s *MemoryStore) RevokeCohortInvite(_ context.Context, tenantID, inviteID string, actorUserID ...string) (core.CohortInvite, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for code, invite := range s.invites {
		if invite.TenantID == tenantID && invite.ID == inviteID {
			now := time.Now().UTC()
			invite.RevokedAt = &now
			s.invites[code] = invite
			s.recordAdminAuditLocked(tenantID, firstActor(actorUserID), "cohort_invite.revoke", "cohort_invite", inviteID, nil, now)
			return invite, nil
		}
	}
	return core.CohortInvite{}, fmt.Errorf("%w: invite", core.ErrNotFound)
}

// GetCohortInviteByCode resolves a code WITHOUT tenant context (public landing
// page). The returned invite carries tenant/cohort display names.
func (s *MemoryStore) GetCohortInviteByCode(_ context.Context, code string) (core.CohortInvite, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	invite, ok := s.invites[code]
	if !ok {
		return core.CohortInvite{}, fmt.Errorf("%w: invite", core.ErrNotFound)
	}
	if tenant, ok := s.tenants[invite.TenantID]; ok {
		invite.TenantName = tenant.Name
	}
	if cohort, ok := s.cohorts[key(invite.TenantID, invite.CohortID)]; ok {
		invite.CohortName = cohort.Name
	}
	return invite, nil
}

// ConsumeCohortInvite increments the use counter after validating the invite
// is still usable. Membership/enrollment are created by the caller.
func (s *MemoryStore) ConsumeCohortInvite(_ context.Context, code string) (core.CohortInvite, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	invite, ok := s.invites[code]
	if !ok {
		return core.CohortInvite{}, fmt.Errorf("%w: invite", core.ErrNotFound)
	}
	if err := inviteUsable(invite, time.Now().UTC()); err != nil {
		return core.CohortInvite{}, err
	}
	invite.UseCount++
	s.invites[code] = invite
	return invite, nil
}

// ---------------------------------------------------------------------------
// Postgres store
// ---------------------------------------------------------------------------

const inviteColumns = `tenant_id::text, id::text, cohort_id::text, code, expires_at, max_uses, use_count, created_by, created_at, revoked_at`

func scanInvite(row pgScanner) (core.CohortInvite, error) {
	var invite core.CohortInvite
	if err := row.Scan(&invite.TenantID, &invite.ID, &invite.CohortID, &invite.Code, &invite.ExpiresAt, &invite.MaxUses, &invite.UseCount, &invite.CreatedBy, &invite.CreatedAt, &invite.RevokedAt); err != nil {
		return core.CohortInvite{}, err
	}
	return invite, nil
}

func (s *PostgresStore) CreateCohortInvite(ctx context.Context, tenantID, cohortID string, expiresAt *time.Time, maxUses int, actorUserID ...string) (core.CohortInvite, error) {
	if maxUses < 0 {
		return core.CohortInvite{}, fmt.Errorf("%w: max_uses must be >= 0", core.ErrInvalidInput)
	}
	invite := core.CohortInvite{
		TenantID:  tenantID,
		ID:        ids.New(),
		CohortID:  cohortID,
		Code:      newInviteCode(),
		ExpiresAt: expiresAt,
		MaxUses:   maxUses,
		CreatedBy: firstActor(actorUserID),
		CreatedAt: time.Now().UTC(),
	}
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM cohorts WHERE tenant_id = $1 AND id = $2)`, tenantID, cohortID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("%w: cohort", core.ErrNotFound)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO cohort_invites (tenant_id, id, cohort_id, code, expires_at, max_uses, created_by, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		`, invite.TenantID, invite.ID, invite.CohortID, invite.Code, invite.ExpiresAt, invite.MaxUses, invite.CreatedBy, invite.CreatedAt); err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(tenantID, invite.CreatedBy, "cohort_invite.create", "cohort_invite", invite.ID, map[string]any{"cohort_id": cohortID}, invite.CreatedAt))
	})
	if err != nil {
		return core.CohortInvite{}, pgErr(err)
	}
	return invite, nil
}

func (s *PostgresStore) ListCohortInvites(ctx context.Context, tenantID, cohortID string) ([]core.CohortInvite, error) {
	var invites []core.CohortInvite
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM cohorts WHERE tenant_id = $1 AND id = $2)`, tenantID, cohortID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("%w: cohort", core.ErrNotFound)
		}
		rows, err := tx.Query(ctx, `
			SELECT `+inviteColumns+`
			FROM cohort_invites
			WHERE tenant_id = $1 AND cohort_id = $2
			ORDER BY created_at DESC
		`, tenantID, cohortID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			invite, err := scanInvite(rows)
			if err != nil {
				return err
			}
			invites = append(invites, invite)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, pgErr(err)
	}
	if invites == nil {
		invites = []core.CohortInvite{}
	}
	return invites, nil
}

func (s *PostgresStore) RevokeCohortInvite(ctx context.Context, tenantID, inviteID string, actorUserID ...string) (core.CohortInvite, error) {
	var invite core.CohortInvite
	err := s.withTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		now := time.Now().UTC()
		row := tx.QueryRow(ctx, `
			UPDATE cohort_invites
			SET revoked_at = COALESCE(revoked_at, $3)
			WHERE tenant_id = $1 AND id = $2
			RETURNING `+inviteColumns+`
		`, tenantID, inviteID, now)
		var err error
		invite, err = scanInvite(row)
		if err != nil {
			return err
		}
		return insertAdminAudit(ctx, tx, newAdminAuditLog(tenantID, firstActor(actorUserID), "cohort_invite.revoke", "cohort_invite", inviteID, nil, now))
	})
	if err != nil {
		return core.CohortInvite{}, pgErr(err)
	}
	return invite, nil
}

func (s *PostgresStore) GetCohortInviteByCode(ctx context.Context, code string) (core.CohortInvite, error) {
	// Deliberately outside any tenant transaction: cohort_invites carries no
	// RLS (see migration 000005) and the code is the secret. Tenant/cohort
	// names are resolved with explicit tenant-scoped follow-up queries.
	row := s.pool.QueryRow(ctx, `SELECT `+inviteColumns+` FROM cohort_invites WHERE code = $1`, code)
	invite, err := scanInvite(row)
	if err != nil {
		return core.CohortInvite{}, pgErr(err)
	}
	err = s.withTenantTx(ctx, invite.TenantID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT name FROM tenants WHERE id = $1`, invite.TenantID).Scan(&invite.TenantName); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT name FROM cohorts WHERE tenant_id = $1 AND id = $2`, invite.TenantID, invite.CohortID).Scan(&invite.CohortName)
	})
	if err != nil {
		return core.CohortInvite{}, pgErr(err)
	}
	return invite, nil
}

func (s *PostgresStore) ConsumeCohortInvite(ctx context.Context, code string) (core.CohortInvite, error) {
	// Atomic validate+increment guarded in SQL so concurrent redemptions
	// cannot blow past max_uses.
	row := s.pool.QueryRow(ctx, `
		UPDATE cohort_invites
		SET use_count = use_count + 1
		WHERE code = $1
		  AND revoked_at IS NULL
		  AND (expires_at IS NULL OR expires_at > now())
		  AND (max_uses = 0 OR use_count < max_uses)
		RETURNING `+inviteColumns, code)
	invite, err := scanInvite(row)
	if err != nil {
		// Distinguish "unknown code" from "known but unusable" for the caller.
		probe := s.pool.QueryRow(ctx, `SELECT `+inviteColumns+` FROM cohort_invites WHERE code = $1`, code)
		if existing, probeErr := scanInvite(probe); probeErr == nil {
			if usableErr := inviteUsable(existing, time.Now().UTC()); usableErr != nil {
				return core.CohortInvite{}, usableErr
			}
		}
		return core.CohortInvite{}, pgErr(err)
	}
	return invite, nil
}
