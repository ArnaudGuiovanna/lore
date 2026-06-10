import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { Assignment } from "@/lib/types";

// B-26 — devoirs (staff side): list + create per cohort.
function staff(role?: string): boolean {
  return role === "TRAINER" || role === "TENANT_ADMIN" || role === "SUPER_ADMIN";
}

// GET ?cohortId=… : the tenant's assignments (optionally one cohort's).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !staff(session.role)) {
    return NextResponse.json({ error: "réservé au personnel pédagogique" }, { status: 403 });
  }
  const cohortId = new URL(req.url).searchParams.get("cohortId") || "";
  const suffix = cohortId ? `/assignments?cohort_id=${encodeURIComponent(cohortId)}` : "/assignments";
  const r = await api.get<Assignment[]>(tpath(suffix));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data ?? [], { status: 200 });
}

interface CreateBody {
  cohortId?: string;
  title?: string;
  description?: string;
  due_at?: string;
  domain_id?: string;
  concept_id?: string;
}

// POST {cohortId, title, description?, due_at?, domain_id?, concept_id?} :
// create a devoir. When domain/concept are set, the manual grade later feeds
// the adaptive engine as corrected evidence.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !staff(session.role)) {
    return NextResponse.json({ error: "réservé au personnel pédagogique" }, { status: 403 });
  }
  const body = (await req.json()) as CreateBody;
  if (!body.cohortId) return NextResponse.json({ error: "cohortId requis" }, { status: 400 });
  if (!body.title?.trim()) return NextResponse.json({ error: "le titre est requis" }, { status: 400 });
  const r = await api.post<Assignment>(tpath(`/cohorts/${encodeURIComponent(body.cohortId)}/assignments`), {
    title: body.title.trim(),
    description: body.description || "",
    due_at: body.due_at || undefined,
    domain_id: body.domain_id || "",
    concept_id: body.concept_id || "",
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
