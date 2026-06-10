import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { TrainingSession } from "@/lib/types";

// GET [?cohortId=…] : planned training sessions (B-25), readable by ANY
// authenticated role — the backend exposes the list to learners too (their
// agenda). The session bearer token rides along via lib/api.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "session requise" }, { status: 403 });
  }
  const cohortId = new URL(req.url).searchParams.get("cohortId") || "";
  const suffix = cohortId
    ? `/training-sessions?cohort_id=${encodeURIComponent(cohortId)}`
    : "/training-sessions";
  const r = await api.get<TrainingSession[]>(tpath(suffix));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data ?? [], { status: 200 });
}
