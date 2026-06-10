import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { CourseModule } from "@/lib/types";

function staff(role?: string): boolean {
  return role === "TRAINER" || role === "TENANT_ADMIN" || role === "SUPER_ADMIN";
}

// PATCH: optional field updates for a module (B-24); DELETE: archive it.
export async function PATCH(req: Request, { params }: { params: Promise<{ moduleId: string }> }) {
  const session = await getSession();
  if (!session || !staff(session.role)) {
    return NextResponse.json({ error: "réservé au personnel pédagogique" }, { status: 403 });
  }
  const { moduleId } = await params;
  const body = (await req.json()) as Partial<CourseModule>;
  const r = await api.patch<CourseModule>(tpath(`/modules/${encodeURIComponent(moduleId)}`), body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ moduleId: string }> }) {
  const session = await getSession();
  if (!session || !staff(session.role)) {
    return NextResponse.json({ error: "réservé au personnel pédagogique" }, { status: 403 });
  }
  const { moduleId } = await params;
  const r = await api.del<CourseModule>(tpath(`/modules/${encodeURIComponent(moduleId)}`));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
