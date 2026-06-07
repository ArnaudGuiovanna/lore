// Postgres backing for the LORE frontend credential store. Activated when
// DATABASE_URL is set (see store.ts, which dispatches to this module). Holds the
// same data as the file backing — bcrypt password hashes + a login email -> LORE
// user id mapping — but in a durable `lore_web_credentials` table so logins
// survive restarts and scale beyond a single node. Server-only.
//
// The table is auto-created on first use (CREATE TABLE IF NOT EXISTS) and demo
// accounts are seeded on first run exactly like the file backing. The Go backend
// still owns identity (users, memberships, roles); this table only owns passwords
// and the email->user-id map, mirroring the file store's responsibilities.
import "server-only";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import type { Role } from "@/lib/types";
import { seed } from "@/lib/config";
import type { Credential } from "./store";

const DOMAIN = "acme.test";

// A single lazily-created pool, shared across requests within a process. pg
// pools are safe to keep for the lifetime of the process.
let _pool: Pool | null = null;
function pool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

function friendlyEmail(name: string, role: Role): string {
  if (role === "TENANT_ADMIN" || role === "SUPER_ADMIN") return `admin@${DOMAIN}`;
  if (role === "TRAINER") return `trainer@${DOMAIN}`;
  const first = (name.split(/\s+/)[0] || "user").toLowerCase().replace(/[^a-z0-9]/g, "") || "user";
  return `${first}@${DOMAIN}`;
}

interface Row {
  email: string;
  name: string;
  role: Role;
  user_id: string;
  tenant_id: string;
  password_hash: string;
  must_change_password: boolean;
  created_at: Date | string;
}

function rowToCredential(r: Row): Credential {
  return {
    email: r.email,
    name: r.name,
    role: r.role,
    userId: r.user_id,
    tenantId: r.tenant_id,
    passwordHash: r.password_hash,
    mustChangePassword: r.must_change_password,
    createdAt: typeof r.created_at === "string" ? r.created_at : r.created_at.toISOString(),
  };
}

// Ensure the table exists and seed demo accounts on first run. Idempotent:
// CREATE TABLE IF NOT EXISTS, and seeding only runs when the table is empty.
let _ready: Promise<void> | null = null;
function ensureReady(): Promise<void> {
  if (!_ready) _ready = init();
  return _ready;
}

async function init(): Promise<void> {
  await pool().query(`
    CREATE TABLE IF NOT EXISTS lore_web_credentials (
      email                 TEXT PRIMARY KEY,
      name                  TEXT NOT NULL,
      role                  TEXT NOT NULL,
      user_id               TEXT NOT NULL,
      tenant_id             TEXT NOT NULL,
      password_hash         TEXT NOT NULL,
      must_change_password  BOOLEAN NOT NULL DEFAULT FALSE,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await seedIfEmpty();
}

// On first run (empty table), derive demo credentials from the seeded LORE users
// — same semantics as the file backing's seedFromBackend().
async function seedIfEmpty(): Promise<void> {
  const { rows } = await pool().query<{ n: string }>(
    "SELECT count(*)::text AS n FROM lore_web_credentials"
  );
  if (Number(rows[0]?.n || "0") > 0) return;

  const s = seed();
  const pw = process.env.DEFAULT_SEED_PASSWORD || "lore123!";
  const hash = bcrypt.hashSync(pw, 10);
  const now = new Date(0).toISOString();

  const seen = new Set<string>();
  const creds = (s.users || [])
    .map((u) => ({
      email: friendlyEmail(u.name, u.role),
      name: u.name,
      role: u.role,
      userId: u.id,
      tenantId: s.tenantId,
      passwordHash: hash,
    }))
    .filter((c) => (seen.has(c.email) ? false : (seen.add(c.email), true)));

  for (const c of creds) {
    // ON CONFLICT DO NOTHING makes concurrent first-run seeding from multiple
    // processes safe (the email PK arbitrates the race).
    await pool().query(
      `INSERT INTO lore_web_credentials
         (email, name, role, user_id, tenant_id, password_hash, must_change_password, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,FALSE,$7)
       ON CONFLICT (email) DO NOTHING`,
      [c.email, c.name, c.role, c.userId, c.tenantId, c.passwordHash, now]
    );
  }
}

export async function listCredentials(): Promise<Credential[]> {
  await ensureReady();
  const { rows } = await pool().query<Row>(
    "SELECT * FROM lore_web_credentials ORDER BY created_at, email"
  );
  return rows.map(rowToCredential);
}

export async function getByEmail(email: string): Promise<Credential | undefined> {
  await ensureReady();
  const e = email.trim().toLowerCase();
  const { rows } = await pool().query<Row>(
    "SELECT * FROM lore_web_credentials WHERE lower(email) = $1 LIMIT 1",
    [e]
  );
  return rows[0] ? rowToCredential(rows[0]) : undefined;
}

export async function verifyPassword(email: string, password: string): Promise<Credential | null> {
  const c = await getByEmail(email);
  if (!c) return null;
  return bcrypt.compareSync(password, c.passwordHash) ? c : null;
}

export async function upsertCredential(input: {
  email: string; name: string; role: Role; userId: string; tenantId: string; password: string;
}): Promise<Credential> {
  await ensureReady();
  const email = input.email.trim().toLowerCase();
  const passwordHash = bcrypt.hashSync(input.password, 10);
  // On insert, created_at defaults to now(); on update we leave created_at as-is
  // (matching the file backing which preserves the original createdAt on upsert).
  const { rows } = await pool().query<Row>(
    `INSERT INTO lore_web_credentials
       (email, name, role, user_id, tenant_id, password_hash, must_change_password)
     VALUES ($1,$2,$3,$4,$5,$6,FALSE)
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name,
       role = EXCLUDED.role,
       user_id = EXCLUDED.user_id,
       tenant_id = EXCLUDED.tenant_id,
       password_hash = EXCLUDED.password_hash
     RETURNING *`,
    [email, input.name, input.role, input.userId, input.tenantId, passwordHash]
  );
  return rowToCredential(rows[0]);
}

export async function setPassword(email: string, password: string): Promise<boolean> {
  await ensureReady();
  const passwordHash = bcrypt.hashSync(password, 10);
  const res = await pool().query(
    "UPDATE lore_web_credentials SET password_hash = $2 WHERE lower(email) = $1",
    [email.trim().toLowerCase(), passwordHash]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function setMustChangePassword(email: string, value: boolean): Promise<boolean> {
  await ensureReady();
  const res = await pool().query(
    "UPDATE lore_web_credentials SET must_change_password = $2 WHERE lower(email) = $1",
    [email.trim().toLowerCase(), value]
  );
  return (res.rowCount ?? 0) > 0;
}

// Role-only update by LORE user id, leaving the password hash untouched. Mirrors
// the file backing's setCredentialRole helper for the Postgres path.
export async function setCredentialRole(userId: string, role: Role): Promise<boolean> {
  await ensureReady();
  const res = await pool().query(
    "UPDATE lore_web_credentials SET role = $2 WHERE user_id = $1",
    [userId, role]
  );
  return (res.rowCount ?? 0) > 0;
}

// RGPD erasure (right to be forgotten): anonymize a credential by LORE user id.
// The row is KEPT for referential/audit integrity, but personal data (email/name)
// is redacted and the password hash is scrambled so the account can no longer be
// used to sign in. Returns the redacted email assigned, or null if no row matched.
export async function anonymizeCredential(userId: string): Promise<string | null> {
  await ensureReady();
  // A stable, unique, non-identifying email so the PK/email-map stays consistent.
  const redactedEmail = `anonymized-${userId}@redacted.invalid`;
  const scrambled = bcrypt.hashSync(`erased-${userId}-${Date.now()}-${Math.random()}`, 10);
  const res = await pool().query(
    `UPDATE lore_web_credentials
        SET email = $2,
            name = 'Utilisateur supprimé (RGPD)',
            password_hash = $3,
            must_change_password = TRUE
      WHERE user_id = $1`,
    [userId, redactedEmail, scrambled]
  );
  return (res.rowCount ?? 0) > 0 ? redactedEmail : null;
}
