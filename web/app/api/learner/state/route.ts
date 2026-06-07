import { NextResponse } from "next/server";
import { api, tpath } from "@/lib/api";
import type { LearnerState } from "@/lib/types";

// GET ?learnerId=&conceptId= : re-read the runtime's refreshed state for a concept.
// Used by the NOW workbench to show the in-column STATE DELTA after evidence is
// recorded. Read-only; the runtime owns these values.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const learnerId = url.searchParams.get("learnerId");
  const conceptId = url.searchParams.get("conceptId");
  if (!learnerId) {
    return NextResponse.json({ error: "learnerId required" }, { status: 400 });
  }
  const r = await api.get<unknown>(tpath(`/learners/${learnerId}/state`));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  const states: LearnerState[] = Array.isArray(r.data)
    ? (r.data as LearnerState[])
    : (((r.data as { states?: LearnerState[] } | null)?.states) ?? []);
  const state = conceptId ? states.find((s) => s.concept_id === conceptId) : states[0];
  return NextResponse.json({ state: state ?? null });
}
