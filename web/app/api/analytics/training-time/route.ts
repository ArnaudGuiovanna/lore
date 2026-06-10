import { NextResponse } from "next/server";
import { api, tpath } from "@/lib/api";
import { getSession } from "@/lib/auth/session";

// GET ?cohortId=…: stream the backend's per-learner training time CSV (B-07).
// Reserved to staff — learners have no business exporting the cohort's hours.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || (session.role !== "TENANT_ADMIN" && session.role !== "TRAINER" && session.role !== "SUPER_ADMIN")) {
    return NextResponse.json({ error: "réservé au personnel" }, { status: 403 });
  }
  const cohortId = new URL(req.url).searchParams.get("cohortId") || "";
  if (!cohortId) return NextResponse.json({ error: "cohortId requis" }, { status: 400 });
  const r = await api.get<string>(tpath(`/analytics/cohorts/${encodeURIComponent(cohortId)}/training-time.csv`));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return new NextResponse(typeof r.data === "string" ? r.data : String(r.data), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lore-temps-formation-${cohortId}.csv"`,
    },
  });
}
