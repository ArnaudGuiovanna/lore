import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { OFDocument } from "@/lib/types";

// B-10 — nouvelle version d'un document contractuel (admin).
function adminOnly(role?: string): boolean {
  return role === "TENANT_ADMIN" || role === "SUPER_ADMIN" || role === "GESTIONNAIRE";
}

export async function POST(req: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const { documentId } = await params;
  const body = (await req.json()) as { title?: string; body?: string };
  const r = await api.post<OFDocument>(
    tpath(`/documents/${encodeURIComponent(documentId)}/versions`),
    { title: body.title || undefined, body: body.body || undefined }
  );
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
