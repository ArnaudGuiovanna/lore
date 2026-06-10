import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { TenantProfile } from "@/lib/types";

// B-08 — profil légal de l'OF : lecture + mise à jour (admin). Proxy vers
// GET/PUT /v1/tenants/{id}/profile avec le jeton porteur de l'admin.
function adminOnly(role?: string): boolean {
  return role === "TENANT_ADMIN" || role === "SUPER_ADMIN";
}

export async function GET() {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const r = await api.get<TenantProfile>(tpath("/profile"));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const body = (await req.json()) as { profile?: Record<string, unknown> };
  const r = await api.put<TenantProfile>(tpath("/profile"), { profile: body.profile ?? {} });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
