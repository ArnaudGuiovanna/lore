import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { OFDocument } from "@/lib/types";

// B-10 — lecture d'une version précise + archivage d'un document (admin).
function adminOnly(role?: string): boolean {
  return role === "TENANT_ADMIN" || role === "SUPER_ADMIN" || role === "GESTIONNAIRE";
}

type Params = { params: Promise<{ documentId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const { documentId } = await params;
  const r = await api.get<OFDocument>(tpath(`/documents/${encodeURIComponent(documentId)}`));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const { documentId } = await params;
  const r = await api.del<OFDocument>(tpath(`/documents/${encodeURIComponent(documentId)}`));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
