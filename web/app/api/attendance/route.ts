// Attendance capture endpoint. A trainer (or admin) marks a learner present/absent
// for a cohort + session date. Persists via the web-tier attendance store
// (Postgres when DATABASE_URL is set, JSON-file fallback otherwise). Server-only.
//
// Authorization: TRAINER, TENANT_ADMIN or SUPER_ADMIN only — enforced here via the
// session role. (The /api/admin middleware guard does not cover this path, so the
// check below is the real boundary for trainer/admin separation.)
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { markPresence } from "@/lib/attendance/store";

interface Body {
  cohortId?: string;
  sessionDate?: string;
  learnerId?: string;
  present?: boolean;
}

const ALLOWED = new Set(["TRAINER", "TENANT_ADMIN", "SUPER_ADMIN"]);

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  if (!ALLOWED.has(session.role)) {
    return NextResponse.json({ error: "only a trainer or administrator may record attendance" }, { status: 403 });
  }

  const body = (await req.json()) as Body;
  const cohortId = (body.cohortId || "").trim();
  const sessionDate = (body.sessionDate || "").trim();
  const learnerId = (body.learnerId || "").trim();
  const present = body.present === true;

  if (!cohortId) return NextResponse.json({ error: "a cohort is required" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
    return NextResponse.json({ error: "a session date (YYYY-MM-DD) is required" }, { status: 400 });
  }
  if (!learnerId) return NextResponse.json({ error: "a learner is required" }, { status: 400 });

  try {
    const rec = await markPresence(cohortId, sessionDate, learnerId, present, "trainer-marked");
    return NextResponse.json(
      {
        learnerId: rec.learnerId,
        cohortId: rec.cohortId,
        sessionDate: rec.sessionDate,
        present: rec.present,
        signedAt: rec.signedAt,
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "could not record attendance" },
      { status: 400 }
    );
  }
}
