import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import { setCredentialRole } from "../_lib/credentials";
import type { Membership, Role } from "@/lib/types";

interface Body {
  userId?: string;
  role?: Role;
}

// A tenant admin may grant TENANT_ADMIN / TRAINER / LEARNER. SUPER_ADMIN is
// cross-tenant and refused here (the backend would also refuse it).
const GRANTABLE: Role[] = ["TENANT_ADMIN", "TRAINER", "LEARNER"];

// POST: change a user's role by (re-)granting a membership. The backend treats
// AddMembership as an upsert of the role, so this re-grant IS the role change.
// The acting admin's bearer token is attached automatically on /v1/tenants/ —
// real RBAC end-to-end.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  if (session.role !== "TENANT_ADMIN" && session.role !== "SUPER_ADMIN" && session.role !== "GESTIONNAIRE") {
    return NextResponse.json({ error: "only an administrator may manage memberships" }, { status: 403 });
  }

  const body = (await req.json()) as Body;
  const userId = (body.userId || "").trim();
  const role = body.role;
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });
  if (!role || !GRANTABLE.includes(role)) {
    return NextResponse.json(
      { error: "role must be one of TENANT_ADMIN, TRAINER, LEARNER" },
      { status: 400 }
    );
  }

  const r = await api.post<Membership>(tpath("/memberships"), { user_id: userId, role });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });

  // The login role is read from the credential store (lib/auth/store.ts), so the
  // backend membership re-grant must be reflected there too — role-only, without
  // re-hashing the password. No-op if the user has no local credential yet.
  const synced = await setCredentialRole(userId, role);

  return NextResponse.json({ ...r.data, credentialSynced: synced }, { status: 200 });
}
