import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { Consent, LegalText } from "@/lib/types";

// B-28 — état du consentement de l'apprenant : les textes légaux publiés
// (dernière version par kind) et SES consentements (le backend rétrécit la
// liste au sujet du jeton). La bannière compare les deux côté client.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "LEARNER") {
    return NextResponse.json({ error: "réservé aux apprenants" }, { status: 403 });
  }
  const [textsRes, consentsRes] = await Promise.all([
    api.get<LegalText[]>(tpath("/legal-texts")),
    api.get<Consent[]>(tpath("/consents")),
  ]);
  if (!textsRes.ok) {
    return NextResponse.json({ error: textsRes.error }, { status: textsRes.status || 502 });
  }
  if (!consentsRes.ok) {
    return NextResponse.json({ error: consentsRes.error }, { status: consentsRes.status || 502 });
  }
  return NextResponse.json(
    { texts: textsRes.data ?? [], consents: consentsRes.data ?? [] },
    { status: 200 }
  );
}
