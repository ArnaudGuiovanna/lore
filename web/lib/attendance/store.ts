// Attendance / émargement store for the LORE frontend. French OFs must capture
// per-session attendance (feuilles de présence). The Go backend has no attendance
// model, so this lives in the WEB tier — backed by Postgres when DATABASE_URL is
// set, with a JSON-file fallback (.gen/attendance.json, owner-only) for zero-config
// local dev. The interface is async regardless of backing, mirroring the credential
// store (lib/auth/store.ts). Server-only.
//
// PLUGGABLE BACKING:
//   - DATABASE_URL set   -> Postgres table `lore_attendance` (auto-created on first
//                           use via CREATE TABLE IF NOT EXISTS). Durable, multi-node,
//                           tenant-scoped by the authenticated session tenant id.
//   - DATABASE_URL unset -> JSON file `.gen/attendance.json` (single-node dev).
//
// Tenant scoping: every row carries tenant_id (the active session tenant). The web
// tier already proves tenancy via the per-user bearer token on backend calls; this
// table mirrors that boundary by stamping + filtering on tenant_id.
import "server-only";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { Pool } from "pg";
import { requireCurrentTenantId } from "@/lib/tenant-context";

// A single durable attendance record. One row per (cohort, session_date, learner).
export interface AttendanceRecord {
  id: string;
  tenantId: string;
  cohortId: string;
  learnerId: string;
  sessionDate: string;   // ISO date (YYYY-MM-DD)
  present: boolean;
  signedAt: string | null; // ISO timestamp when presence was recorded (the digital "signature")
  method: string;          // how presence was captured, e.g. "trainer-marked"
  createdAt: string;       // ISO timestamp
}

// A distinct session = a date on which at least one attendance row exists for a cohort.
export interface AttendanceSession {
  cohortId: string;
  sessionDate: string;
  present: number;
  absent: number;
  total: number;
}

function usePg(): boolean {
  return !!process.env.DATABASE_URL;
}

const FILE = join(process.cwd(), ".gen", "attendance.json");

// Deterministic-enough id; crypto.randomUUID is available in Node 18+ runtimes.
function newId(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `att-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
}

// Normalise an incoming session date to YYYY-MM-DD (the table column is `date`).
function normDate(d: string): string {
  const s = (d || "").trim();
  // Already a bare date — keep it. Otherwise take the date part of an ISO datetime.
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (!m) throw new Error(`invalid session date: ${JSON.stringify(d)}`);
  return m[1];
}

// ---------------------------------------------------------------------------
// Postgres backing
// ---------------------------------------------------------------------------

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
    CREATE TABLE IF NOT EXISTS lore_attendance (
      id            TEXT PRIMARY KEY,
      tenant_id     TEXT NOT NULL,
      cohort_id     TEXT NOT NULL,
      learner_id    TEXT NOT NULL,
      session_date  DATE NOT NULL,
      present       BOOLEAN NOT NULL DEFAULT FALSE,
      signed_at     TIMESTAMPTZ,
      method        TEXT NOT NULL DEFAULT 'trainer-marked',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, cohort_id, learner_id, session_date)
    )
  `);
}

interface Row {
  id: string;
  tenant_id: string;
  cohort_id: string;
  learner_id: string;
  session_date: Date | string;
  present: boolean;
  signed_at: Date | string | null;
  method: string;
  created_at: Date | string;
}

function isoDate(d: Date | string): string {
  if (typeof d === "string") return normDate(d);
  // pg returns DATE as a JS Date at local midnight; format as YYYY-MM-DD without TZ drift.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoTs(d: Date | string | null): string | null {
  if (d === null || d === undefined) return null;
  return typeof d === "string" ? d : d.toISOString();
}

function rowToRecord(r: Row): AttendanceRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    cohortId: r.cohort_id,
    learnerId: r.learner_id,
    sessionDate: isoDate(r.session_date),
    present: r.present,
    signedAt: isoTs(r.signed_at),
    method: r.method,
    createdAt: isoTs(r.created_at) ?? new Date(0).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// File backing (default, single-node dev). Owner-only file like users.json.
// ---------------------------------------------------------------------------

function loadFile(): AttendanceRecord[] {
  if (!existsSync(FILE)) return [];
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Array<Partial<AttendanceRecord>>;
    return raw.map((r) => ({
      id: r.id ?? newId(),
      tenantId: r.tenantId ?? "",
      cohortId: r.cohortId ?? "",
      learnerId: r.learnerId ?? "",
      sessionDate: r.sessionDate ?? "",
      present: r.present ?? false,
      signedAt: r.signedAt ?? null,
      method: r.method ?? "trainer-marked",
      createdAt: r.createdAt ?? new Date(0).toISOString(),
    }));
  } catch {
    return [];
  }
}

function saveFile(records: AttendanceRecord[]): void {
  mkdirSync(dirname(FILE), { recursive: true, mode: 0o700 });
  try { chmodSync(dirname(FILE), 0o700); } catch { /* best-effort (non-POSIX FS) */ }
  writeFileSync(FILE, JSON.stringify(records, null, 2), { mode: 0o600 });
  try { chmodSync(FILE, 0o600); } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// Public async interface
// ---------------------------------------------------------------------------

// List the distinct sessions (dates with attendance) for a cohort, most recent first,
// with present/absent tallies. Tenant-scoped to the active session tenant.
export async function listSessions(cohortId: string): Promise<AttendanceSession[]> {
  const tenantId = await requireCurrentTenantId();
  if (usePg()) {
    await ensureReady();
    const { rows } = await pool().query<{ session_date: Date | string; present: string; absent: string; total: string }>(
      `SELECT session_date,
              count(*) FILTER (WHERE present)::text     AS present,
              count(*) FILTER (WHERE NOT present)::text AS absent,
              count(*)::text                            AS total
         FROM lore_attendance
        WHERE tenant_id = $1 AND cohort_id = $2
        GROUP BY session_date
        ORDER BY session_date DESC`,
      [tenantId, cohortId]
    );
    return rows.map((r) => ({
      cohortId,
      sessionDate: isoDate(r.session_date),
      present: Number(r.present),
      absent: Number(r.absent),
      total: Number(r.total),
    }));
  }

  const mine = loadFile().filter((r) => r.tenantId === tenantId && r.cohortId === cohortId);
  const byDate = new Map<string, AttendanceSession>();
  for (const r of mine) {
    const s = byDate.get(r.sessionDate) ?? { cohortId, sessionDate: r.sessionDate, present: 0, absent: 0, total: 0 };
    s.total += 1;
    if (r.present) s.present += 1;
    else s.absent += 1;
    byDate.set(r.sessionDate, s);
  }
  return Array.from(byDate.values()).sort((a, b) => (a.sessionDate < b.sessionDate ? 1 : -1));
}

// Get the attendance rows for one cohort + session date (one row per marked learner).
export async function getAttendance(cohortId: string, sessionDate: string): Promise<AttendanceRecord[]> {
  const tenantId = await requireCurrentTenantId();
  const date = normDate(sessionDate);
  if (usePg()) {
    await ensureReady();
    const { rows } = await pool().query<Row>(
      `SELECT * FROM lore_attendance
        WHERE tenant_id = $1 AND cohort_id = $2 AND session_date = $3
        ORDER BY learner_id`,
      [tenantId, cohortId, date]
    );
    return rows.map(rowToRecord);
  }
  return loadFile()
    .filter((r) => r.tenantId === tenantId && r.cohortId === cohortId && r.sessionDate === date)
    .sort((a, b) => a.learnerId.localeCompare(b.learnerId));
}

// Mark (upsert) a learner's presence for a cohort + session date. Idempotent on
// (tenant, cohort, learner, date): re-marking updates present/signed_at/method.
export async function markPresence(
  cohortId: string,
  sessionDate: string,
  learnerId: string,
  present: boolean,
  method = "trainer-marked"
): Promise<AttendanceRecord> {
  const tenantId = await requireCurrentTenantId();
  const date = normDate(sessionDate);
  const now = new Date().toISOString();
  // signed_at is the moment presence was captured — only meaningful when present.
  const signedAt = present ? now : null;

  if (usePg()) {
    await ensureReady();
    const { rows } = await pool().query<Row>(
      `INSERT INTO lore_attendance
         (id, tenant_id, cohort_id, learner_id, session_date, present, signed_at, method)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id, cohort_id, learner_id, session_date) DO UPDATE SET
         present   = EXCLUDED.present,
         signed_at = EXCLUDED.signed_at,
         method    = EXCLUDED.method
       RETURNING *`,
      [newId(), tenantId, cohortId, learnerId, date, present, signedAt, method]
    );
    return rowToRecord(rows[0]);
  }

  const records = loadFile();
  const idx = records.findIndex(
    (r) => r.tenantId === tenantId && r.cohortId === cohortId && r.learnerId === learnerId && r.sessionDate === date
  );
  if (idx >= 0) {
    const rec = records[idx];
    rec.present = present;
    rec.signedAt = signedAt;
    rec.method = method;
    saveFile(records);
    return rec;
  }
  const rec: AttendanceRecord = {
    id: newId(),
    tenantId,
    cohortId,
    learnerId,
    sessionDate: date,
    present,
    signedAt,
    method,
    createdAt: now,
  };
  records.push(rec);
  saveFile(records);
  return rec;
}

// RGPD erasure: anonymize a learner's attendance rows. The rows are KEPT (a session
// still happened — present/absent tallies and dates stay accurate for the OF audit),
// but the learner is re-keyed to a non-identifying pseudonym so the rows no longer
// point back to a person. Returns the number of rows re-keyed. Tenant-scoped.
export async function anonymizeLearnerAttendance(learnerId: string): Promise<number> {
  const tenantId = await requireCurrentTenantId();
  const pseudonym = `anonymized-${learnerId}`;
  if (usePg()) {
    await ensureReady();
    const res = await pool().query(
      "UPDATE lore_attendance SET learner_id = $3 WHERE tenant_id = $1 AND learner_id = $2",
      [tenantId, learnerId, pseudonym]
    );
    return res.rowCount ?? 0;
  }
  const records = loadFile();
  let n = 0;
  for (const r of records) {
    if (r.tenantId === tenantId && r.learnerId === learnerId) {
      r.learnerId = pseudonym;
      n += 1;
    }
  }
  if (n > 0) saveFile(records);
  return n;
}

// All attendance rows for a single learner (used by the RGPD export aggregator).
// Tenant-scoped. Most recent session first.
export async function getLearnerAttendance(learnerId: string): Promise<AttendanceRecord[]> {
  const tenantId = await requireCurrentTenantId();
  if (usePg()) {
    await ensureReady();
    const { rows } = await pool().query<Row>(
      `SELECT * FROM lore_attendance
        WHERE tenant_id = $1 AND learner_id = $2
        ORDER BY session_date DESC`,
      [tenantId, learnerId]
    );
    return rows.map(rowToRecord);
  }
  return loadFile()
    .filter((r) => r.tenantId === tenantId && r.learnerId === learnerId)
    .sort((a, b) => (a.sessionDate < b.sessionDate ? 1 : -1));
}
