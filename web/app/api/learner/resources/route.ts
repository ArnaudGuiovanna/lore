import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { Resource } from "@/lib/types";

// B-17 — ressources de l'apprenant. Le jeton porteur suffit : le backend
// restreint la liste à SON périmètre (ses cohortes + tenant entier).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "LEARNER") {
    return NextResponse.json({ error: "réservé aux apprenants" }, { status: 403 });
  }
  const r = await api.get<Resource[]>(tpath("/resources"));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data ?? [], { status: 200 });
}
