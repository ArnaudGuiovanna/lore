// Server-side bridge to the LORE backend's auth/identity using the operator
// bootstrap secret (never exposed to the browser). Server-only.
import "server-only";
import { BACKEND_BASE } from "@/lib/config";
import type { Role } from "@/lib/types";

function boot(): string {
  return process.env.LORE_BOOTSTRAP_TOKEN || "";
}

async function jsonOrNull(res: Response): Promise<any> {
  const t = await res.text();
  try { return t ? JSON.parse(t) : null; } catch { return t; }
}

// Mint a per-user LORE bearer token (role + tenant derived from membership).
export async function mintToken(tenantId: string, userId: string, ttlSeconds = 60 * 60 * 12): Promise<string | null> {
  const res = await fetch(`${BACKEND_BASE}/v1/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-LORE-Bootstrap-Token": boot() },
    body: JSON.stringify({ tenant_id: tenantId, user_id: userId, ttl_seconds: ttlSeconds }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await jsonOrNull(res);
  return data?.access_token ?? null;
}

// Provision a user + tenant membership (used by invite/signup). Returns the LORE user id.
export async function ensureUserAndMembership(
  email: string, name: string, role: Role, tenantId: string
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  // create the user (open route); on email-conflict we cannot resolve the id, so surface it.
  const ures = await fetch(`${BACKEND_BASE}/v1/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, name }),
    cache: "no-store",
  });
  const udata = await jsonOrNull(ures);
  if (!ures.ok || !udata?.id) {
    return { ok: false, error: udata?.error || `could not create user (HTTP ${ures.status})` };
  }
  const userId = String(udata.id);
  const mres = await fetch(`${BACKEND_BASE}/v1/tenants/${tenantId}/memberships`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-LORE-Bootstrap-Token": boot() },
    body: JSON.stringify({ user_id: userId, role }),
    cache: "no-store",
  });
  if (!mres.ok) {
    const m = await jsonOrNull(mres);
    return { ok: false, error: m?.error || `could not grant membership (HTTP ${mres.status})` };
  }
  return { ok: true, userId };
}
