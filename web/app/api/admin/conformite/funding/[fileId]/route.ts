import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { FundingFile } from "@/lib/types";

// B-15 — édition (PATCH) + archivage (DELETE) d'un dossier de financement.
function adminOnly(role?: string): boolean {
  return role === "TENANT_ADMIN" || role === "SUPER_ADMIN" || role === "GESTIONNAIRE";
}

type Params = { params: Promise<{ fileId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const { fileId } = await params;
  const body = (await req.json()) as Partial<FundingFile>;
  const r = await api.patch<FundingFile>(tpath(`/funding-files/${encodeURIComponent(fileId)}`), body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const { fileId } = await params;
  const r = await api.del<FundingFile>(tpath(`/funding-files/${encodeURIComponent(fileId)}`));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
