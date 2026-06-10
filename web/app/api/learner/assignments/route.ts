import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import { BACKEND_BASE } from "@/lib/config";
import type { Assignment, AssignmentSubmission } from "@/lib/types";

// B-26 — learner view of the devoirs: each assignment of their cohortes plus
// THEIR OWN submission (status à rendre / rendu / noté). The assignment list
// uses the learner's bearer token (the backend authorizes it); the submission
// read is staff-scoped on the backend, so the TRUSTED web tier reads it with
// the bootstrap secret and narrows strictly to the authenticated learner —
// the browser never sees another learner's copy.

export interface LearnerAssignmentRow {
  assignment: Assignment;
  submission: AssignmentSubmission | null;
}

async function ownSubmission(
  tenantId: string,
  assignmentId: string,
  learnerId: string,
  boot: string
): Promise<AssignmentSubmission | null> {
  try {
    const res = await fetch(
      `${BACKEND_BASE}/v1/tenants/${encodeURIComponent(tenantId)}/assignments/${encodeURIComponent(assignmentId)}/submissions`,
      { headers: { "X-LORE-Bootstrap-Token": boot }, cache: "no-store" }
    );
    if (!res.ok) return null;
    const subs = (await res.json()) as AssignmentSubmission[];
    return (Array.isArray(subs) ? subs : []).find((s) => s.learner_id === learnerId) ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "LEARNER") {
    return NextResponse.json({ error: "réservé aux apprenants" }, { status: 403 });
  }
  const r = await api.get<Assignment[]>(tpath("/assignments"));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  const assignments = (Array.isArray(r.data) ? r.data : []).filter((a) => !a.archived_at);

  const boot = process.env.LORE_BOOTSTRAP_TOKEN || "";
  const rows: LearnerAssignmentRow[] = await Promise.all(
    assignments.map(async (assignment) => ({
      assignment,
      // Without the bootstrap secret the status degrades to "à rendre" reads —
      // we never fabricate a grade.
      submission: boot
        ? await ownSubmission(session.tenantId, assignment.id, session.userId, boot)
        : null,
    }))
  );
  return NextResponse.json(rows, { status: 200 });
}
