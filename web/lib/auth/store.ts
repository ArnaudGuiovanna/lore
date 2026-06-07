// Credential store for the LORE frontend. The Go backend owns identity (users,
// memberships, roles) but not passwords, so the frontend holds password hashes
// and maps a login email -> the LORE user id. File-backed (.gen/users.json) for
// single-node self-hosting; swap for Postgres in a larger deployment. Server-only.
import "server-only";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import bcrypt from "bcryptjs";
import type { Role } from "@/lib/types";
import { seed } from "@/lib/config";

export interface Credential {
  email: string;
  name: string;
  role: Role;
  userId: string;   // the LORE user id (== learner id for learners)
  tenantId: string;
  passwordHash: string;
  createdAt: string;
}

const FILE = join(process.cwd(), ".gen", "users.json");
const DOMAIN = "acme.test";

function friendlyEmail(name: string, role: Role): string {
  if (role === "TENANT_ADMIN" || role === "SUPER_ADMIN") return `admin@${DOMAIN}`;
  if (role === "TRAINER") return `trainer@${DOMAIN}`;
  const first = (name.split(/\s+/)[0] || "user").toLowerCase().replace(/[^a-z0-9]/g, "") || "user";
  return `${first}@${DOMAIN}`;
}

function load(): Credential[] {
  if (!existsSync(FILE)) return seedFromBackend();
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Credential[];
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
    createdAt: now,
  }));
  // de-dupe by email (keep first)
  const seen = new Set<string>();
  const deduped = creds.filter((c) => (seen.has(c.email) ? false : (seen.add(c.email), true)));
  if (deduped.length) save(deduped);
  return deduped;
}

export function listCredentials(): Credential[] {
  return load();
}

export function getByEmail(email: string): Credential | undefined {
  const e = email.trim().toLowerCase();
  return load().find((c) => c.email.toLowerCase() === e);
}

export function verifyPassword(email: string, password: string): Credential | null {
  const c = getByEmail(email);
  if (!c) return null;
  return bcrypt.compareSync(password, c.passwordHash) ? c : null;
}

export function upsertCredential(input: {
  email: string; name: string; role: Role; userId: string; tenantId: string; password: string;
}): Credential {
  const creds = load();
  const email = input.email.trim().toLowerCase();
  const cred: Credential = {
    email,
    name: input.name,
    role: input.role,
    userId: input.userId,
    tenantId: input.tenantId,
    passwordHash: bcrypt.hashSync(input.password, 10),
    createdAt: new Date().toISOString(),
  };
  const idx = creds.findIndex((c) => c.email.toLowerCase() === email);
  if (idx >= 0) creds[idx] = { ...cred, createdAt: creds[idx].createdAt };
  else creds.push(cred);
  save(creds);
  return cred;
}

export function setPassword(email: string, password: string): boolean {
  const creds = load();
  const c = creds.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
  if (!c) return false;
  c.passwordHash = bcrypt.hashSync(password, 10);
  save(creds);
  return true;
}
