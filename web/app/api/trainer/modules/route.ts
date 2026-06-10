import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { CourseModule } from "@/lib/types";

// Course modules (B-24) — trainer-side proxy. Authoring is reserved to staff;
// the backend middleware re-enforces the same rule with the bearer token.
function staff(role?: string): boolean {
  return role === "TRAINER" || role === "TENANT_ADMIN" || role === "SUPER_ADMIN";
}

// GET ?syllabusId=… : active (non-archived) modules of a syllabus, ordered by position.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !staff(session.role)) {
    return NextResponse.json({ error: "réservé au personnel pédagogique" }, { status: 403 });
  }
  const syllabusId = new URL(req.url).searchParams.get("syllabusId") || "";
  if (!syllabusId) {
    return NextResponse.json({ error: "syllabusId requis" }, { status: 400 });
  }
  const r = await api.get<CourseModule[]>(tpath(`/syllabi/${encodeURIComponent(syllabusId)}/modules`));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data ?? [], { status: 200 });
}

interface CreateBody {
  syllabusId: string;
  title: string;
  description?: string;
  position: number;
  concept_ids: string[];
  prerequisite_ids: string[];
  required_mastery: number;
}

// POST {syllabusId, …} : create a module. Prerequisites must point at modules
// of strictly lower position — validated by the backend (single acyclicity rule).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !staff(session.role)) {
    return NextResponse.json({ error: "réservé au personnel pédagogique" }, { status: 403 });
  }
  const body = (await req.json()) as CreateBody;
  if (!body.syllabusId) {
    return NextResponse.json({ error: "syllabusId requis" }, { status: 400 });
  }
  const r = await api.post<CourseModule>(tpath(`/syllabi/${encodeURIComponent(body.syllabusId)}/modules`), {
    title: body.title,
    description: body.description ?? "",
    position: body.position,
    concept_ids: body.concept_ids ?? [],
    prerequisite_ids: body.prerequisite_ids ?? [],
    required_mastery: body.required_mastery,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
