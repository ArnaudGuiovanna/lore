import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { BACKEND_BASE } from "@/lib/config";
import { requireCurrentTenantId } from "@/lib/tenant-context";

// GET [?cohortId=…] : iCalendar passthrough (B-25). The backend renders the
// text/calendar feed; we only authenticate the caller and forward the bytes
// untouched (any role — a learner exports their own agenda).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "session requise" }, { status: 403 });
  }
  let tenantId: string;
  try {
    tenantId = await requireCurrentTenantId();
  } catch {
    return NextResponse.json({ error: "session requise" }, { status: 403 });
  }
  const cohortId = new URL(req.url).searchParams.get("cohortId") || "";
  const qs = cohortId ? `?cohort_id=${encodeURIComponent(cohortId)}` : "";
  const upstream = await fetch(
    `${BACKEND_BASE}/v1/tenants/${encodeURIComponent(tenantId)}/training-sessions.ics${qs}`,
    { headers: { Authorization: `Bearer ${session.loreToken}` }, cache: "no-store" }
  ).catch(() => null);
  if (!upstream || !upstream.ok) {
    return NextResponse.json(
      { error: `export ICS indisponible (HTTP ${upstream?.status ?? 0})` },
      { status: upstream?.status || 502 }
    );
  }
  const body = await upstream.text();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="lore-sessions.ics"',
      "Cache-Control": "no-store",
    },
  });
}
