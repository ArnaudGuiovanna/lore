import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { Complaint } from "@/lib/types";

// B-11 — workflow d'une réclamation : changement de statut + résolution (admin).
function adminOnly(role?: string): boolean {
  return role === "TENANT_ADMIN" || role === "SUPER_ADMIN";
}

export async function PATCH(req: Request, { params }: { params: Promise<{ complaintId: string }> }) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const { complaintId } = await params;
  const body = (await req.json()) as { status?: string; resolution?: string };
  const r = await api.patch<Complaint>(tpath(`/complaints/${encodeURIComponent(complaintId)}`), {
    status: body.status,
    resolution: body.resolution || undefined,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
