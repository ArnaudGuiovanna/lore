import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { TrainingSession } from "@/lib/types";

function adminOnly(role?: string): boolean {
  return role === "TENANT_ADMIN" || role === "SUPER_ADMIN";
}

// PATCH: update a planned session; DELETE: archive it (B-12).
export async function PATCH(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const { sessionId } = await params;
  const body = (await req.json()) as Partial<TrainingSession>;
  const r = await api.patch<TrainingSession>(tpath(`/training-sessions/${encodeURIComponent(sessionId)}`), body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const { sessionId } = await params;
  const r = await api.del<TrainingSession>(tpath(`/training-sessions/${encodeURIComponent(sessionId)}`));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
