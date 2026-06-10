import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { TrainingSession } from "@/lib/types";

// Planned training sessions (B-12): list + create, proxied to the backend with
// the acting admin's bearer token (RBAC enforced server-side too).
function staffOnly(role?: string): boolean {
  return role === "TENANT_ADMIN" || role === "SUPER_ADMIN" || role === "GESTIONNAIRE";
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || (!staffOnly(session.role) && session.role !== "TRAINER")) {
    return NextResponse.json({ error: "réservé au personnel" }, { status: 403 });
  }
  const cohortId = new URL(req.url).searchParams.get("cohortId") || "";
  const suffix = cohortId ? `/training-sessions?cohort_id=${encodeURIComponent(cohortId)}` : "/training-sessions";
  const r = await api.get<TrainingSession[]>(tpath(suffix));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data ?? [], { status: 200 });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !staffOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const body = (await req.json()) as Partial<TrainingSession>;
  const r = await api.post<TrainingSession>(tpath("/training-sessions"), body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
