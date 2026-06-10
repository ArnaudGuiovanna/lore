import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { OFDocument } from "@/lib/types";

// B-10 — documents de l'apprenant. Le jeton porteur de l'apprenant suffit :
// le backend restreint la liste à SES documents (adressés à lui, à ses
// cohortes actives, ou au tenant entier comme le règlement intérieur).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "LEARNER") {
    return NextResponse.json({ error: "réservé aux apprenants" }, { status: 403 });
  }
  const r = await api.get<OFDocument[]>(tpath("/documents"));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data ?? [], { status: 200 });
}
