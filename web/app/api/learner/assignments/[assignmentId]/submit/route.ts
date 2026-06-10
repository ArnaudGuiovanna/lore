import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { AssignmentSubmission } from "@/lib/types";

// POST {content} : hand in (or replace, while ungraded) the authenticated
// learner's work on a devoir (B-26). learner_id comes from the SESSION — the
// backend's learner-token guard re-checks it (no IDOR via the body).
export async function POST(req: Request, { params }: { params: Promise<{ assignmentId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "LEARNER") {
    return NextResponse.json({ error: "réservé aux apprenants" }, { status: 403 });
  }
  const { assignmentId } = await params;
  const body = (await req.json().catch(() => ({}))) as { content?: string };
  const content = (body.content || "").trim();
  if (!content) return NextResponse.json({ error: "le contenu du rendu est requis" }, { status: 400 });

  const r = await api.post<AssignmentSubmission>(
    tpath(`/assignments/${encodeURIComponent(assignmentId)}/submissions`),
    { learner_id: session.userId, content }
  );
  if (!r.ok) {
    const msg =
      r.status === 409 ? "Ce devoir a déjà été noté — le rendu ne peut plus être modifié." : r.error;
    return NextResponse.json({ error: msg }, { status: r.status || 502 });
  }
  return NextResponse.json(r.data, { status: 201 });
}
