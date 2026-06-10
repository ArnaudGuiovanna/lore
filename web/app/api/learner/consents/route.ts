import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { Consent } from "@/lib/types";

// B-28 — « J'accepte » : enregistre le consentement de l'apprenant pour un
// texte légal précis. L'identité vient du jeton, jamais du corps de requête.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "LEARNER") {
    return NextResponse.json({ error: "réservé aux apprenants" }, { status: 403 });
  }
  const body = (await req.json()) as { legal_text_id?: string };
  const legalTextId = (body.legal_text_id || "").trim();
  if (!legalTextId) {
    return NextResponse.json({ error: "legal_text_id est requis" }, { status: 400 });
  }
  const r = await api.post<Consent>(tpath("/consents"), { legal_text_id: legalTextId });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
