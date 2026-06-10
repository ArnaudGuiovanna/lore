import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { SurveyResponse } from "@/lib/types";

// B-11 — réponse de l'apprenant à une enquête. L'identité vient de la session
// (le backend vérifie que le jeton apprenant répond bien pour lui-même et
// qu'il est inscrit à la cohorte de l'enquête).
export async function POST(req: Request, { params }: { params: Promise<{ surveyId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "LEARNER") {
    return NextResponse.json({ error: "réservé aux apprenants" }, { status: 403 });
  }
  const { surveyId } = await params;
  const body = (await req.json()) as { answers?: Record<string, number | string> };
  const r = await api.post<SurveyResponse>(
    tpath(`/surveys/${encodeURIComponent(surveyId)}/responses`),
    { learner_id: session.userId, answers: body.answers ?? {} }
  );
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
