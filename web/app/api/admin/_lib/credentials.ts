// Admin-scoped credential helper for a role-only update (the login role is read
// from the credential store, so a backend membership re-grant must be reflected
// there too — WITHOUT re-hashing / invalidating the password).
//
// The foundation store (lib/auth/store.ts) now owns this operation across BOTH
// backings (Postgres when DATABASE_URL is set, file otherwise), so this thin
// wrapper simply delegates to it. Server-only.
import "server-only";
import type { Role } from "@/lib/types";
import { setCredentialRole as storeSetCredentialRole } from "@/lib/auth/store";

// Update only the role for a stored credential, identified by LORE user id.
// Leaves the password hash untouched. Returns true if a row was updated.
export async function setCredentialRole(userId: string, role: Role): Promise<boolean> {
  return storeSetCredentialRole(userId, role);
}
