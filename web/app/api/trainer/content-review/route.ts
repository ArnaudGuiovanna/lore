import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { GeneratedContent } from "@/lib/types";

// B-16 — file de curation : ce que le LLM a réellement enseigné, à relire.
// Réservé au personnel pédagogique (le backend refuse aussi le GESTIONNAIRE
// sur content-review — acte pédagogique).
function pedagogicalStaff(role?: string): boolean {
  return role === "TRAINER" || role === "TENANT_ADMIN" || role === "SUPER_ADMIN";
}

// GET ?status=PENDING_REVIEW|APPROVED|REJECTED (défaut backend : tous).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !pedagogicalStaff(session.role)) {
    return NextResponse.json({ error: "réservé au personnel pédagogique" }, { status: 403 });
  }
  const status = new URL(req.url).searchParams.get("status") || "";
  const suffix = status ? `/content-review?status=${encodeURIComponent(status)}` : "/content-review";
  const r = await api.get<GeneratedContent[]>(tpath(suffix));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data ?? [], { status: 200 });
}
