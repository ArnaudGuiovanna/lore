import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { SurveyResponse } from "@/lib/types";

// B-11 — réponses d'une enquête (staff) : la moyenne par question scale et les
// verbatims sont calculés côté client à partir de ces lignes brutes.
function adminOnly(role?: string): boolean {
  return role === "TENANT_ADMIN" || role === "SUPER_ADMIN";
}

export async function GET(_req: Request, { params }: { params: Promise<{ surveyId: string }> }) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const { surveyId } = await params;
  const r = await api.get<SurveyResponse[]>(
    tpath(`/surveys/${encodeURIComponent(surveyId)}/responses`)
  );
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data ?? [], { status: 200 });
}
