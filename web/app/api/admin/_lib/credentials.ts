// Admin-scoped credential helpers that live ALONGSIDE the auth foundation's
// credential store (lib/auth/store.ts) without modifying it. The store owns
// password hashing + the login mapping; here we only need a role-only update
// (the login role is read from this store, so a backend membership re-grant must
// be reflected here too — WITHOUT re-hashing / invalidating the password).
// Server-only. File-backed, same .gen/users.json the foundation store uses.
import "server-only";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Role } from "@/lib/types";
import { listCredentials } from "@/lib/auth/store";

const FILE = join(process.cwd(), ".gen", "users.json");

// Update only the role for a stored credential, identified by LORE user id.
// Leaves the password hash untouched. Returns true if a row was updated.
export function setCredentialRole(userId: string, role: Role): boolean {
  // listCredentials() seeds the file from the backend on first run, so by the
  // time we read it here it exists and is consistent with the store's view.
  listCredentials();
  if (!existsSync(FILE)) return false;
  let rows: Array<Record<string, unknown>>;
  try {
    rows = JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    return false;
  }
  const row = rows.find((r) => r.userId === userId);
  if (!row) return false;
  row.role = role;
  writeFileSync(FILE, JSON.stringify(rows, null, 2));
  return true;
}
