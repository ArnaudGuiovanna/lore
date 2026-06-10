import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { AssignmentSubmission } from "@/lib/types";

function staff(role?: string): boolean {
  return role === "TRAINER" || role === "TENANT_ADMIN" || role === "SUPER_ADMIN";
}

interface Body {
  score?: number; // 0..1
  feedback?: string;
}

// POST {score (0..1), feedback?} : manual grade (B-26). When the devoir is
// bound to a concept, the backend bridges the score into the adaptive engine.
export async function POST(req: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  const session = await getSession();
  if (!session || !staff(session.role)) {
    return NextResponse.json({ error: "réservé au personnel pédagogique" }, { status: 403 });
  }
  const { submissionId } = await params;
  const body = (await req.json()) as Body;
  const score = Number(body.score);
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    return NextResponse.json({ error: "score requis entre 0 et 1" }, { status: 400 });
  }
  const r = await api.post<{ submission: AssignmentSubmission; state_delta?: unknown }>(
    tpath(`/submissions/${encodeURIComponent(submissionId)}/grade`),
    { score, feedback: body.feedback || "" }
  );
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
