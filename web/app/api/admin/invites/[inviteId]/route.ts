import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { CohortInvite } from "@/lib/types";

function adminOnly(role?: string): boolean {
  return role === "TENANT_ADMIN" || role === "SUPER_ADMIN";
}

// DELETE: revoke an invitation link (B-23). The code stops working immediately;
// accounts already created through it are not affected.
export async function DELETE(_req: Request, { params }: { params: Promise<{ inviteId: string }> }) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const { inviteId } = await params;
  const r = await api.del<CohortInvite>(tpath(`/invites/${encodeURIComponent(inviteId)}`));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
