import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";

// B-08 — export Qualiopi : bundle JSON de preuves d'une cohorte (admin).
// GET /api/admin/conformite/qualiopi?cohortId=… → le client télécharge le JSON.
function adminOnly(role?: string): boolean {
  return role === "TENANT_ADMIN" || role === "SUPER_ADMIN" || role === "GESTIONNAIRE";
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const cohortId = new URL(req.url).searchParams.get("cohortId") || "";
  if (!cohortId) return NextResponse.json({ error: "cohortId est requis" }, { status: 400 });
  const r = await api.get<Record<string, unknown>>(
    tpath(`/cohorts/${encodeURIComponent(cohortId)}/qualiopi-export`)
  );
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
