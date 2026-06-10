import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { LegalText } from "@/lib/types";

// B-28 — textes légaux versionnés (admin) : dernière version par kind
// (?history=1 pour l'historique complet) + publication d'une nouvelle version.
function adminOnly(role?: string): boolean {
  return role === "TENANT_ADMIN" || role === "SUPER_ADMIN" || role === "GESTIONNAIRE";
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const history = new URL(req.url).searchParams.get("history") === "1";
  const r = await api.get<LegalText[]>(tpath(history ? "/legal-texts?history=1" : "/legal-texts"));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data ?? [], { status: 200 });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const body = (await req.json()) as { kind?: string; body?: string };
  const r = await api.post<LegalText>(tpath("/legal-texts"), {
    kind: body.kind,
    body: body.body,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
