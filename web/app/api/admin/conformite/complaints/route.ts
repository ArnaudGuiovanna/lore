import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { Complaint } from "@/lib/types";

// B-11 — registre des réclamations (staff) : liste + ouverture au nom d'un tiers.
function adminOnly(role?: string): boolean {
  return role === "TENANT_ADMIN" || role === "SUPER_ADMIN";
}

export async function GET() {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const r = await api.get<Complaint[]>(tpath("/complaints"));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data ?? [], { status: 200 });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const body = (await req.json()) as Partial<Complaint>;
  const r = await api.post<Complaint>(tpath("/complaints"), {
    subject: body.subject,
    description: body.description,
    learner_id: body.learner_id || undefined,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
