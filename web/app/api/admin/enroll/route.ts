import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { CohortEnrollment } from "@/lib/types";

interface Body {
  cohort_id?: string;
  learner_id?: string;
}

// POST: enroll a learner into a cohort in the acting admin's tenant.
// Backend: POST /v1/tenants/{t}/cohorts/{cohort}/enrollments {learner_id}
//   -> emits LearnerEnrolled.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  if (session.role !== "TENANT_ADMIN" && session.role !== "SUPER_ADMIN" && session.role !== "GESTIONNAIRE") {
    return NextResponse.json({ error: "only an administrator may enroll learners" }, { status: 403 });
  }

  const body = (await req.json()) as Body;
  const cohortId = (body.cohort_id || "").trim();
  const learnerId = (body.learner_id || "").trim();
  if (!cohortId) return NextResponse.json({ error: "a cohort is required" }, { status: 400 });
  if (!learnerId) return NextResponse.json({ error: "a learner is required" }, { status: 400 });

  const r = await api.post<CohortEnrollment>(
    tpath(`/cohorts/${cohortId}/enrollments`),
    { learner_id: learnerId }
  );
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
