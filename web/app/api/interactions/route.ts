import { NextResponse } from "next/server";
import { api, tpath } from "@/lib/api";
import type { Interaction } from "@/lib/types";

interface Body {
  learner_id: string;
  activity_id: string;
  success: boolean;
  score: number;
  error_type?: string;
  idempotencyKey: string;
}

// POST: record a learner interaction. The Idempotency-Key is taken from
// body.idempotencyKey so retries are safe.
export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const { idempotencyKey, ...payload } = body;
  const r = await api.post<Interaction>(tpath("/interactions"), payload, { idempotencyKey });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
