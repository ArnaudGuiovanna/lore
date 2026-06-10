import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { Interaction } from "@/lib/types";

// B-13 — positionnement de début de formation (exigence Qualiopi) : la
// première évaluation corrigée par concept (date, score, items). Lecture
// réservée au personnel ; l'apprenant est désigné par la query, jamais le
// contraire (le backend re-vérifie le périmètre avec le jeton porteur).
function staff(role?: string): boolean {
  return role === "TRAINER" || role === "TENANT_ADMIN" || role === "SUPER_ADMIN" || role === "GESTIONNAIRE";
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !staff(session.role)) {
    return NextResponse.json({ error: "réservé au personnel" }, { status: 403 });
  }
  const url = new URL(req.url);
  const learnerId = url.searchParams.get("learnerId") || "";
  const domainId = url.searchParams.get("domainId") || "";
  if (!learnerId) {
    return NextResponse.json({ error: "learnerId est requis" }, { status: 400 });
  }
  const suffix = `/learners/${encodeURIComponent(learnerId)}/positioning${
    domainId ? `?domain_id=${encodeURIComponent(domainId)}` : ""
  }`;
  const r = await api.get<Interaction[]>(tpath(suffix));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data ?? [], { status: 200 });
}
