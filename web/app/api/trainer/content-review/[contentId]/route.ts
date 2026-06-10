import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { GeneratedContent } from "@/lib/types";

// B-16 — verdict de curation : APPROVED ou REJECTED (+ note). Un contenu
// REJECTED disparaît des lectures persistées.
function pedagogicalStaff(role?: string): boolean {
  return role === "TRAINER" || role === "TENANT_ADMIN" || role === "SUPER_ADMIN";
}

export async function POST(req: Request, { params }: { params: Promise<{ contentId: string }> }) {
  const session = await getSession();
  if (!session || !pedagogicalStaff(session.role)) {
    return NextResponse.json({ error: "réservé au personnel pédagogique" }, { status: 403 });
  }
  const { contentId } = await params;
  const body = (await req.json()) as { status?: string; note?: string };
  if (body.status !== "APPROVED" && body.status !== "REJECTED") {
    return NextResponse.json({ error: "status doit être APPROVED ou REJECTED" }, { status: 400 });
  }
  const r = await api.post<GeneratedContent>(
    tpath(`/content-review/${encodeURIComponent(contentId)}`),
    { status: body.status, note: body.note || "" }
  );
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
