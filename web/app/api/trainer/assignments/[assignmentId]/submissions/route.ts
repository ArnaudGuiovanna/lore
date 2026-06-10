import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { AssignmentSubmission } from "@/lib/types";

function staff(role?: string): boolean {
  return role === "TRAINER" || role === "TENANT_ADMIN" || role === "SUPER_ADMIN";
}

// GET: a devoir's submissions (correction queue, staff only) (B-26).
export async function GET(_req: Request, { params }: { params: Promise<{ assignmentId: string }> }) {
  const session = await getSession();
  if (!session || !staff(session.role)) {
    return NextResponse.json({ error: "réservé au personnel pédagogique" }, { status: 403 });
  }
  const { assignmentId } = await params;
  const r = await api.get<AssignmentSubmission[]>(
    tpath(`/assignments/${encodeURIComponent(assignmentId)}/submissions`)
  );
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data ?? [], { status: 200 });
}
