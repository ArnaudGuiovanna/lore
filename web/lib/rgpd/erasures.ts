// RGPD erasure tombstone log. When an admin erases/anonymizes a learner, we keep a
// non-identifying record THAT an erasure happened (who acted, when, what was redacted)
// — proof of the right-to-be-forgotten action for an audit, without re-introducing
// the personal data that was removed. Postgres-backed when DATABASE_URL is set, JSON
// file fallback (.gen/rgpd-erasures.json, owner-only) otherwise. Server-only.
import "server-only";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { Pool } from "pg";
import { requireCurrentTenantId } from "@/lib/tenant-context";

export interface ErasureRecord {
  id: string;
  tenantId: string;
  subjectUserId: string;   // the LORE user id whose data was erased (pseudonymous after)
  actorUserId: string;     // the admin who performed the erasure
  redactedEmail: string | null;
  attendanceRowsAnonymized: number;
  credentialAnonymized: boolean;
  createdAt: string;
}

function usePg(): boolean {
  return !!process.env.DATABASE_URL;
}

const FILE = join(process.cwd(), ".gen", "rgpd-erasures.json");

function newId(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `era-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
}

let _pool: Pool | null = null;
function pool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return _pool;
}

let _ready: Promise<void> | null = null;
function ensureReady(): Promise<void> {
  if (!_ready) _ready = init();
  return _ready;
}

async function init(): Promise<void> {
  await pool().query(`
    CREATE TABLE IF NOT EXISTS lore_rgpd_erasures (
      id                          TEXT PRIMARY KEY,
      tenant_id                   TEXT NOT NULL,
      subject_user_id             TEXT NOT NULL,
      actor_user_id               TEXT NOT NULL,
      redacted_email              TEXT,
      attendance_rows_anonymized  INTEGER NOT NULL DEFAULT 0,
      credential_anonymized       BOOLEAN NOT NULL DEFAULT FALSE,
      created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

function loadFile(): ErasureRecord[] {
  if (!existsSync(FILE)) return [];
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as ErasureRecord[];
  } catch {
    return [];
  }
}

function saveFile(records: ErasureRecord[]): void {
  mkdirSync(dirname(FILE), { recursive: true, mode: 0o700 });
  try { chmodSync(dirname(FILE), 0o700); } catch { /* best-effort */ }
  writeFileSync(FILE, JSON.stringify(records, null, 2), { mode: 0o600 });
  try { chmodSync(FILE, 0o600); } catch { /* best-effort */ }
}

export async function recordErasure(input: {
  subjectUserId: string;
  actorUserId: string;
  redactedEmail: string | null;
  attendanceRowsAnonymized: number;
  credentialAnonymized: boolean;
}): Promise<ErasureRecord> {
  const tenantId = await requireCurrentTenantId();
  const rec: ErasureRecord = {
    id: newId(),
    tenantId,
    subjectUserId: input.subjectUserId,
    actorUserId: input.actorUserId,
    redactedEmail: input.redactedEmail,
    attendanceRowsAnonymized: input.attendanceRowsAnonymized,
    credentialAnonymized: input.credentialAnonymized,
    createdAt: new Date().toISOString(),
  };

  if (usePg()) {
    await ensureReady();
    await pool().query(
      `INSERT INTO lore_rgpd_erasures
         (id, tenant_id, subject_user_id, actor_user_id, redacted_email, attendance_rows_anonymized, credential_anonymized)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [rec.id, rec.tenantId, rec.subjectUserId, rec.actorUserId, rec.redactedEmail, rec.attendanceRowsAnonymized, rec.credentialAnonymized]
    );
    return rec;
  }

  const records = loadFile();
  records.push(rec);
  saveFile(records);
  return rec;
}

// Has this subject already been erased? (Used to surface a tombstone in the UI.)
export async function listErasures(): Promise<ErasureRecord[]> {
  const tenantId = await requireCurrentTenantId();
  if (usePg()) {
    await ensureReady();
    const { rows } = await pool().query<ErasureRecord & { created_at: string; subject_user_id: string; actor_user_id: string; redacted_email: string | null; attendance_rows_anonymized: number; credential_anonymized: boolean; tenant_id: string }>(
      "SELECT * FROM lore_rgpd_erasures WHERE tenant_id = $1 ORDER BY created_at DESC",
      [tenantId]
    );
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      subjectUserId: r.subject_user_id,
      actorUserId: r.actor_user_id,
      redactedEmail: r.redacted_email,
      attendanceRowsAnonymized: r.attendance_rows_anonymized,
      credentialAnonymized: r.credential_anonymized,
      createdAt: typeof r.created_at === "string" ? r.created_at : new Date(r.created_at).toISOString(),
    }));
  }
  return loadFile().filter((r) => r.tenantId === tenantId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
