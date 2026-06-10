import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { OFDocument } from "@/lib/types";

// B-10 — documents contractuels (admin) : liste (dernière version par chaîne)
// + création. Proxy vers /v1/tenants/{id}/documents.
function adminOnly(role?: string): boolean {
  return role === "TENANT_ADMIN" || role === "SUPER_ADMIN" || role === "GESTIONNAIRE";
}

export async function GET() {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const r = await api.get<OFDocument[]>(tpath("/documents"));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data ?? [], { status: 200 });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const body = (await req.json()) as Partial<OFDocument>;
  const r = await api.post<OFDocument>(tpath("/documents"), {
    kind: body.kind,
    title: body.title,
    body: body.body,
    cohort_id: body.cohort_id || undefined,
    learner_id: body.learner_id || undefined,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
