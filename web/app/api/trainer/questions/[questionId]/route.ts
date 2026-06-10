import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { BankQuestion } from "@/lib/types";

function staff(role?: string): boolean {
  return role === "TRAINER" || role === "TENANT_ADMIN" || role === "SUPER_ADMIN";
}

// DELETE: archive a bank question (B-26) — it leaves the active list but the
// backend keeps the row (audit + past assessments stay attributable).
export async function DELETE(_req: Request, { params }: { params: Promise<{ questionId: string }> }) {
  const session = await getSession();
  if (!session || !staff(session.role)) {
    return NextResponse.json({ error: "réservé au personnel pédagogique" }, { status: 403 });
  }
  const { questionId } = await params;
  const r = await api.del<BankQuestion>(tpath(`/questions/${encodeURIComponent(questionId)}`));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
