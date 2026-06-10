import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { Announcement } from "@/lib/types";

// B-18 — annonces. Lecture : tout rôle authentifié (le backend restreint un
// jeton apprenant à ses cohortes + tenant entier). Écriture : staff seulement.
function staff(role?: string): boolean {
  return role === "TRAINER" || role === "TENANT_ADMIN" || role === "SUPER_ADMIN" || role === "GESTIONNAIRE";
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "authentification requise" }, { status: 401 });
  const r = await api.get<Announcement[]>(tpath("/announcements"));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data ?? [], { status: 200 });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !staff(session.role)) {
    return NextResponse.json({ error: "réservé au personnel" }, { status: 403 });
  }
  const body = (await req.json()) as { title?: string; body?: string; cohort_id?: string };
  if (!body.title?.trim()) return NextResponse.json({ error: "le titre est requis" }, { status: 400 });
  const r = await api.post<Announcement>(tpath("/announcements"), {
    title: body.title.trim(),
    body: body.body || "",
    cohort_id: body.cohort_id || "",
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
