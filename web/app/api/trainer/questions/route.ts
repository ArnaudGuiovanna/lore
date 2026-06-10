import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { BankQuestion } from "@/lib/types";

// B-26 — banque de questions (staff only). The backend re-enforces the same
// boundary with the bearer token (learners are rejected by the middleware).
function staff(role?: string): boolean {
  return role === "TRAINER" || role === "TENANT_ADMIN" || role === "SUPER_ADMIN";
}

// GET ?conceptId=… : active questions, optionally filtered by concept.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !staff(session.role)) {
    return NextResponse.json({ error: "réservé au personnel pédagogique" }, { status: 403 });
  }
  const conceptId = new URL(req.url).searchParams.get("conceptId") || "";
  const suffix = conceptId ? `/questions?concept_id=${encodeURIComponent(conceptId)}` : "/questions";
  const r = await api.get<BankQuestion[]>(tpath(suffix));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data ?? [], { status: 200 });
}

// POST: create a question (QCM single_choice or réponse courte short_answer).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !staff(session.role)) {
    return NextResponse.json({ error: "réservé au personnel pédagogique" }, { status: 403 });
  }
  const body = (await req.json()) as Partial<BankQuestion>;
  const r = await api.post<BankQuestion>(tpath("/questions"), {
    concept_id: body.concept_id || "",
    kind: body.kind,
    prompt: body.prompt,
    choices: body.choices ?? [],
    correct_choice_id: body.correct_choice_id || "",
    expected_answer: body.expected_answer || "",
    points: Number(body.points) || 1,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
