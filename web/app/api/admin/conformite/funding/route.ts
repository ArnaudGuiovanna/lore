import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { FundingFile } from "@/lib/types";

// B-15 — dossiers de financement (admin) : liste + création. Les montants
// transitent en cents (la conversion € → cents est faite côté client).
function adminOnly(role?: string): boolean {
  return role === "TENANT_ADMIN" || role === "SUPER_ADMIN" || role === "GESTIONNAIRE";
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const learnerId = new URL(req.url).searchParams.get("learnerId") || "";
  const suffix = learnerId
    ? `/funding-files?learner_id=${encodeURIComponent(learnerId)}`
    : "/funding-files";
  const r = await api.get<FundingFile[]>(tpath(suffix));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data ?? [], { status: 200 });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const body = (await req.json()) as Partial<FundingFile>;
  const r = await api.post<FundingFile>(tpath("/funding-files"), {
    learner_id: body.learner_id,
    cohort_id: body.cohort_id || undefined,
    funder_type: body.funder_type,
    funder_name: body.funder_name || undefined,
    reference: body.reference || undefined,
    status: body.status || undefined,
    amount_cents: body.amount_cents,
    notes: body.notes || undefined,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
