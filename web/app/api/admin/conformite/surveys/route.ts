import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { SatisfactionSurvey, SurveyQuestion } from "@/lib/types";

// B-11 — enquêtes de satisfaction (admin) : liste + création sur une cohorte.
function adminOnly(role?: string): boolean {
  return role === "TENANT_ADMIN" || role === "SUPER_ADMIN" || role === "GESTIONNAIRE";
}

export async function GET() {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const r = await api.get<SatisfactionSurvey[]>(tpath("/surveys"));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data ?? [], { status: 200 });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const body = (await req.json()) as {
    cohort_id?: string;
    kind?: string;
    title?: string;
    questions?: SurveyQuestion[];
    opens_at?: string | null;
    closes_at?: string | null;
  };
  const cohortId = (body.cohort_id || "").trim();
  if (!cohortId) return NextResponse.json({ error: "cohort_id est requis" }, { status: 400 });
  const r = await api.post<SatisfactionSurvey>(
    tpath(`/cohorts/${encodeURIComponent(cohortId)}/surveys`),
    {
      kind: body.kind,
      title: body.title,
      questions: body.questions ?? [],
      opens_at: body.opens_at || undefined,
      closes_at: body.closes_at || undefined,
    }
  );
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
