import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { loadLearnerPath } from "@/lib/learner-path";

// GET ?syllabusId=… : the module path (B-24) of the AUTHENTICATED learner —
// always session.userId, never a client-supplied id. The backend enforces that
// a learner token only reads its own path; staff tokens pass too.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "session requise" }, { status: 403 });
  }
  const syllabusId = new URL(req.url).searchParams.get("syllabusId") || "";
  if (!syllabusId) {
    return NextResponse.json({ error: "syllabusId requis" }, { status: 400 });
  }
  const r = await loadLearnerPath(session.userId, syllabusId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json(r.data, { status: 200 });
}
