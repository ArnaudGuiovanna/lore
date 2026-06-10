import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { Complaint } from "@/lib/types";

// B-11 — dépôt d'une réclamation par l'apprenant. Le backend force l'identité
// depuis le jeton (un apprenant ne réclame que pour lui-même).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "LEARNER") {
    return NextResponse.json({ error: "réservé aux apprenants" }, { status: 403 });
  }
  const body = (await req.json()) as { subject?: string; description?: string };
  const subject = (body.subject || "").trim();
  if (!subject) return NextResponse.json({ error: "l'objet est requis" }, { status: 400 });
  const r = await api.post<Complaint>(tpath("/complaints"), {
    subject,
    description: (body.description || "").trim() || undefined,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
