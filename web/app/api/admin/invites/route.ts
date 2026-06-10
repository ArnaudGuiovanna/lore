import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { CohortInvite } from "@/lib/types";

// B-23 — cohort invitation links (admin-managed), proxied with the acting
// admin's bearer token (the backend re-enforces the admin-only rule).
function adminOnly(role?: string): boolean {
  return role === "TENANT_ADMIN" || role === "SUPER_ADMIN";
}

// GET ?cohortId=… : the cohort's invites (active and not).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const cohortId = new URL(req.url).searchParams.get("cohortId") || "";
  if (!cohortId) return NextResponse.json({ error: "cohortId requis" }, { status: 400 });
  const r = await api.get<CohortInvite[]>(tpath(`/cohorts/${encodeURIComponent(cohortId)}/invites`));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data ?? [], { status: 200 });
}

interface CreateBody {
  cohortId?: string;
  expires_in_hours?: number;
  max_uses?: number; // 0 = illimité
}

// POST {cohortId, expires_in_hours, max_uses} : mint a new shareable code.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const body = (await req.json()) as CreateBody;
  if (!body.cohortId) return NextResponse.json({ error: "cohortId requis" }, { status: 400 });
  const r = await api.post<CohortInvite>(tpath(`/cohorts/${encodeURIComponent(body.cohortId)}/invites`), {
    expires_in_hours: Number(body.expires_in_hours) || 0,
    max_uses: Number(body.max_uses) || 0,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
