import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { Resource } from "@/lib/types";

// B-17 — archivage d'une ressource (staff).
function staff(role?: string): boolean {
  return role === "TRAINER" || role === "TENANT_ADMIN" || role === "SUPER_ADMIN" || role === "GESTIONNAIRE";
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ resourceId: string }> }) {
  const session = await getSession();
  if (!session || !staff(session.role)) {
    return NextResponse.json({ error: "réservé au personnel" }, { status: 403 });
  }
  const { resourceId } = await params;
  const r = await api.del<Resource>(tpath(`/resources/${encodeURIComponent(resourceId)}`));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
