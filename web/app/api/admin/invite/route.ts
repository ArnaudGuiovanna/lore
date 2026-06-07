import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/auth/session";
import { ensureUserAndMembership } from "@/lib/auth/lore";
import { getByEmail, upsertCredential } from "@/lib/auth/store";
import type { Role } from "@/lib/types";

interface Body {
  email?: string;
  name?: string;
  role?: Role;
}

// A tenant admin may only invite within their own tenant, and may not grant
// SUPER_ADMIN (cross-tenant — bootstrap/super-admin only). Mirror the backend's
// authorizeMembershipWrite boundary so the UI never offers an illegal grant.
const INVITABLE: Role[] = ["TENANT_ADMIN", "TRAINER", "LEARNER"];

// Human-friendly temporary password: short, unambiguous, shared once.
function tempPassword(): string {
  return randomBytes(9).toString("base64url").replace(/[-_]/g, "").slice(0, 12);
}

// POST: invite/create a user with a role in the acting admin's tenant.
//   1) ensureUserAndMembership -> creates the LORE user + tenant membership
//   2) upsertCredential -> stores a temp password so the user can sign in
//   3) returns the temp password ONCE so the admin can share it out-of-band
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  if (session.role !== "TENANT_ADMIN" && session.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "only an administrator may invite users" }, { status: 403 });
  }

  const body = (await req.json()) as Body;
  const email = (body.email || "").trim().toLowerCase();
  const name = (body.name || "").trim();
  const role = body.role;

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "a valid email is required" }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: "a name is required" }, { status: 400 });
  if (!role || !INVITABLE.includes(role)) {
    return NextResponse.json(
      { error: "role must be one of TENANT_ADMIN, TRAINER, LEARNER" },
      { status: 400 }
    );
  }
  if (await getByEmail(email)) {
    return NextResponse.json(
      { error: "a user with this email already has credentials in this tenant" },
      { status: 409 }
    );
  }

  // (a) provision the LORE user + membership (role is granted by the membership).
  const provisioned = await ensureUserAndMembership(email, name, role, session.tenantId);
  if (!provisioned.ok) {
    return NextResponse.json({ error: provisioned.error }, { status: 502 });
  }

  // (b) issue a temporary password mapped to the new LORE user id.
  const password = tempPassword();
  await upsertCredential({
    email,
    name,
    role,
    userId: provisioned.userId,
    tenantId: session.tenantId,
    password,
  });

  // (c) hand the temp password back exactly once.
  return NextResponse.json(
    { userId: provisioned.userId, email, name, role, tempPassword: password },
    { status: 201 }
  );
}
