import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { Consent } from "@/lib/types";

// B-28 — registre des consentements (staff) : qui a accepté quel texte, en
// quelle version, quand. ?userId= pour filtrer sur un utilisateur.
function adminOnly(role?: string): boolean {
  return role === "TENANT_ADMIN" || role === "SUPER_ADMIN" || role === "GESTIONNAIRE";
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const userId = new URL(req.url).searchParams.get("userId") || "";
  const suffix = userId ? `/consents?user_id=${encodeURIComponent(userId)}` : "/consents";
  const r = await api.get<Consent[]>(tpath(suffix));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data ?? [], { status: 200 });
}
