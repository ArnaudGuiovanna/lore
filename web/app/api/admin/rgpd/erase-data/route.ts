// B-14 — effacement RGPD côté BACKEND : DELETE /v1/tenants/{t}/learners/{id}/data
// purge toutes les traces du runtime (états, activités, snapshots, révisions…)
// et tombstone l'identité côté backend. Complète l'anonymisation du tiers web
// (/api/admin/rgpd/erase : identifiants de connexion + émargement).
// Admin uniquement (middleware /api/admin + contrôle de rôle ici). Server-only.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";

const ADMIN = new Set(["TENANT_ADMIN", "SUPER_ADMIN"]);

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  if (!ADMIN.has(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const body = (await req.json()) as { learnerId?: string };
  const learnerId = (body.learnerId || "").trim();
  if (!learnerId) return NextResponse.json({ error: "learnerId est requis" }, { status: 400 });
  if (learnerId === session.userId) {
    return NextResponse.json({ error: "vous ne pouvez pas effacer votre propre compte" }, { status: 400 });
  }
  const r = await api.del<{ erased: Record<string, number> }>(
    tpath(`/learners/${encodeURIComponent(learnerId)}/data`)
  );
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
