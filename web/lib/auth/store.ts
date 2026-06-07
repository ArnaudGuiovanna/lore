// Credential store for the LORE frontend. The Go backend owns identity (users,
// memberships, roles) but not passwords, so the frontend holds password hashes
// and maps a login email -> the LORE user id.
//
// PLUGGABLE BACKING: this module is a thin async façade over two interchangeable
// backings behind the SAME interface:
//   - DATABASE_URL set   -> Postgres table `lore_web_credentials` (store.pg.ts),
//                           durable + multi-node (logins survive restarts/scale).
//   - DATABASE_URL unset -> JSON file `.gen/users.json` (single-node, zero-config
//                           local dev — the original behaviour, unchanged).
// Both seed the demo accounts the same way on first run and keep bcrypt hashing.
// Callers await these functions regardless of backing. Server-only.
import "server-only";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import bcrypt from "bcryptjs";
import type { Role } from "@/lib/types";
import { seed } from "@/lib/config";
import * as pg from "./store.pg";

export interface Credential {
  email: string;
  name: string;
  role: Role;
  userId: string;   // the LORE user id (== learner id for learners)
  tenantId: string;
  passwordHash: string;
  mustChangePassword: boolean; // force a password reset on next login (e.g. invited users)
  createdAt: string;
}

// True when the durable Postgres backing is configured. Computed per-call so a
// test/process that sets DATABASE_URL late still picks it up.
function usePg(): boolean {
  return !!process.env.DATABASE_URL;
}

const FILE = join(process.cwd(), ".gen", "users.json");
const DOMAIN = "acme.test";

function friendlyEmail(name: string, role: Role): string {
  if (role === "TENANT_ADMIN" || role === "SUPER_ADMIN") return `admin@${DOMAIN}`;
  if (role === "TRAINER") return `trainer@${DOMAIN}`;
  const first = (name.split(/\s+/)[0] || "user").toLowerCase().replace(/[^a-z0-9]/g, "") || "user";
  return `${first}@${DOMAIN}`;
}

// ---------------------------------------------------------------------------
// File backing (default, single-node). Unchanged semantics from the original
// store, plus the new mustChangePassword field (defaulted on read for forward
// compatibility with pre-existing .gen/users.json files).
// ---------------------------------------------------------------------------

function load(): Credential[] {
  if (!existsSync(FILE)) return seedFromBackend();
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Array<Partial<Credential>>;
    return raw.map((c) => ({
      email: c.email ?? "",
      name: c.name ?? "",
      role: c.role as Role,
      userId: c.userId ?? "",
      tenantId: c.tenantId ?? "",
      passwordHash: c.passwordHash ?? "",
      mustChangePassword: c.mustChangePassword ?? false,
      createdAt: c.createdAt ?? new Date(0).toISOString(),
    }));
  } catch {
    return [];
  }
}

function save(creds: Credential[]): void {
  writeUsersFileSecure(JSON.stringify(creds, null, 2));
}

// The credential file holds bcrypt password hashes, so it must be owner-only.
// chmod is applied explicitly because writeFileSync's `mode` is ignored when the
// file already exists (it does not downgrade an already-permissive file).
export function writeUsersFileSecure(data: string): void {
  mkdirSync(dirname(FILE), { recursive: true, mode: 0o700 });
  try { chmodSync(dirname(FILE), 0o700); } catch { /* best-effort (e.g. non-POSIX FS) */ }
  writeFileSync(FILE, data, { mode: 0o600 });
  try { chmodSync(FILE, 0o600); } catch { /* best-effort */ }
}

// On first run, derive demo credentials from the seeded LORE users (friendly
// login emails + a default password). Real users are added via invite/signup.
function seedFromBackend(): Credential[] {
  const s = seed();
  const pw = process.env.DEFAULT_SEED_PASSWORD || "lore123!";
  const hash = bcrypt.hashSync(pw, 10);
  const now = new Date(0).toISOString();
  const creds: Credential[] = (s.users || []).map((u) => ({
    email: friendlyEmail(u.name, u.role),
    name: u.name,
    role: u.role,
    userId: u.id,
    tenantId: s.tenantId,
    passwordHash: hash,
    mustChangePassword: false,
    createdAt: now,
  }));
  // de-dupe by email (keep first)
  const seen = new Set<string>();
  const deduped = creds.filter((c) => (seen.has(c.email) ? false : (seen.add(c.email), true)));
  if (deduped.length) save(deduped);
  return deduped;
}

// ---------------------------------------------------------------------------
// Public interface (async). Dispatches to the Postgres or file backing.
// ---------------------------------------------------------------------------

export async function listCredentials(): Promise<Credential[]> {
  if (usePg()) return pg.listCredentials();
  return load();
}

export async function getByEmail(email: string): Promise<Credential | undefined> {
  if (usePg()) return pg.getByEmail(email);
  const e = email.trim().toLowerCase();
  return load().find((c) => c.email.toLowerCase() === e);
}

export async function verifyPassword(email: string, password: string): Promise<Credential | null> {
  if (usePg()) return pg.verifyPassword(email, password);
  const c = await getByEmail(email);
  if (!c) return null;
  return bcrypt.compareSync(password, c.passwordHash) ? c : null;
}

export async function upsertCredential(input: {
  email: string; name: string; role: Role; userId: string; tenantId: string; password: string;
}): Promise<Credential> {
  if (usePg()) return pg.upsertCredential(input);
  const creds = load();
  const email = input.email.trim().toLowerCase();
  const cred: Credential = {
    email,
    name: input.name,
    role: input.role,
    userId: input.userId,
    tenantId: input.tenantId,
    passwordHash: bcrypt.hashSync(input.password, 10),
    mustChangePassword: false,
    createdAt: new Date().toISOString(),
  };
  const idx = creds.findIndex((c) => c.email.toLowerCase() === email);
  if (idx >= 0) cred.createdAt = creds[idx].createdAt;
  if (idx >= 0) creds[idx] = cred;
  else creds.push(cred);
  save(creds);
  return cred;
}

export async function setPassword(email: string, password: string): Promise<boolean> {
  if (usePg()) return pg.setPassword(email, password);
  const creds = load();
  const c = creds.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
  if (!c) return false;
  c.passwordHash = bcrypt.hashSync(password, 10);
  save(creds);
  return true;
}

// Force (or clear) a password reset on next login. Another stream uses this to
// require invited users to set a real password the first time they sign in; this
// module only provides the field + setter and does not change login behaviour.
export async function setMustChangePassword(email: string, value: boolean): Promise<boolean> {
  if (usePg()) return pg.setMustChangePassword(email, value);
  const creds = load();
  const c = creds.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
  if (!c) return false;
  c.mustChangePassword = value;
  save(creds);
  return true;
}

// Role-only update by LORE user id, leaving the password hash untouched. Used
// when a backend membership re-grant must be reflected in the login role. Exposed
// here so the Postgres path is handled too (the file path is also implemented in
// app/api/admin/_lib/credentials.ts for its direct file manipulation).
export async function setCredentialRole(userId: string, role: Role): Promise<boolean> {
  if (usePg()) return pg.setCredentialRole(userId, role);
  const creds = load();
  const c = creds.find((x) => x.userId === userId);
  if (!c) return false;
  c.role = role;
  save(creds);
  return true;
}

// RGPD erasure (right to be forgotten): anonymize a credential by LORE user id.
// The row is KEPT (referential integrity + a tombstone for audit), but personal
// data (email/name) is redacted and the password hash is scrambled so the account
// can no longer authenticate. Returns the redacted email, or null if no row matched.
export async function anonymizeCredential(userId: string): Promise<string | null> {
  if (usePg()) return pg.anonymizeCredential(userId);
  const creds = load();
  const c = creds.find((x) => x.userId === userId);
  if (!c) return null;
  const redactedEmail = `anonymized-${userId}@redacted.invalid`;
  c.email = redactedEmail;
  c.name = "Utilisateur supprimé (RGPD)";
  c.passwordHash = bcrypt.hashSync(`erased-${userId}-${Date.now()}-${Math.random()}`, 10);
  c.mustChangePassword = true;
  save(creds);
  return redactedEmail;
}
