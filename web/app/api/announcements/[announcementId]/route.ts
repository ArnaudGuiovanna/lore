import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { Announcement } from "@/lib/types";

// B-18 — archivage d'une annonce (staff).
function staff(role?: string): boolean {
  return role === "TRAINER" || role === "TENANT_ADMIN" || role === "SUPER_ADMIN" || role === "GESTIONNAIRE";
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ announcementId: string }> }) {
  const session = await getSession();
  if (!session || !staff(session.role)) {
    return NextResponse.json({ error: "réservé au personnel" }, { status: 403 });
  }
  const { announcementId } = await params;
  const r = await api.del<Announcement>(tpath(`/announcements/${encodeURIComponent(announcementId)}`));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
