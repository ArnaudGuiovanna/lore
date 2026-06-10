import { NextResponse } from "next/server";
import { api, tpath } from "@/lib/api";
import type { AssessmentAnswer, Interaction } from "@/lib/types";

interface Body {
  learner_id: string;
  answers: AssessmentAnswer[];
  success?: boolean;
  score?: number;
  confidence?: number;
  feedback?: string;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
}

export async function POST(req: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const { activityId } = await params;
  const body = (await req.json()) as Body;
  const { idempotencyKey, ...payload } = body;
  const r = await api.post<Interaction>(tpath(`/assessments/${activityId}/submit`), payload, { idempotencyKey });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
