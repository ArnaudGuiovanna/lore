import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { BPFReport } from "@/lib/types";

// B-15 — rapport BPF annuel (admin) : GET /api/admin/conformite/bpf?year=YYYY.
function adminOnly(role?: string): boolean {
  return role === "TENANT_ADMIN" || role === "SUPER_ADMIN";
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const year = new URL(req.url).searchParams.get("year") || "";
  if (!/^\d{4}$/.test(year)) {
    return NextResponse.json({ error: "year=YYYY est requis" }, { status: 400 });
  }
  const r = await api.get<BPFReport>(tpath(`/bpf-export?year=${year}`));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
