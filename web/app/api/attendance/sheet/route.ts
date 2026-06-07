// Feuille d'émargement (attendance sheet) PDF export. Generates a French A4 PDF for
// a cohort + session date from persisted attendance rows joined with learner names
// from the credential store + seed roster. TRAINER/ADMIN only. Server-only.
import { getSession } from "@/lib/auth/session";
import { seed } from "@/lib/config";
import { listCredentials } from "@/lib/auth/store";
import { getAttendance } from "@/lib/attendance/store";
import { buildAttendanceSheetPdf, type AttendanceSheetLearner } from "@/lib/pdf/attendance";

const ALLOWED = new Set(["TRAINER", "TENANT_ADMIN", "SUPER_ADMIN"]);

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return new Response(JSON.stringify({ error: "not authenticated" }), { status: 401, headers: { "Content-Type": "application/json" } });
  if (!ALLOWED.has(session.role)) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }

  const url = new URL(req.url);
  const cohortId = (url.searchParams.get("cohort") || "").trim();
  const sessionDate = (url.searchParams.get("date") || "").trim();
  if (!cohortId || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
    return new Response(JSON.stringify({ error: "cohort and date (YYYY-MM-DD) are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const s = seed();
  const rows = await getAttendance(cohortId, sessionDate);

  // Resolve human names: credential store first, then the seeded roster.
  const creds = await listCredentials();
  const nameFor = (learnerId: string): string => {
    const c = creds.find((x) => x.userId === learnerId);
    if (c) return c.name;
    const l = s.learners.find((x) => x.id === learnerId);
    if (l) return l.name;
    return learnerId;
  };

  // Build the sheet from the full seeded roster so absentees still appear with a
  // blank/absent line — an émargement sheet must list every enrolled stagiaire.
  const byLearner = new Map(rows.map((r) => [r.learnerId, r]));
  const rosterIds = new Set<string>(s.learners.map((l) => l.id));
  for (const r of rows) rosterIds.add(r.learnerId); // include anyone marked who isn't in the seed

  const learners: AttendanceSheetLearner[] = Array.from(rosterIds)
    .map((id) => {
      const rec = byLearner.get(id);
      return { name: nameFor(id), present: rec?.present ?? false, signedAt: rec?.signedAt ?? null };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

  const pdf = await buildAttendanceSheetPdf({
    orgName: s.tenantName || s.tenantSlug || "Organisme de formation",
    cohortName: s.cohortName || cohortId,
    sessionDate,
    learners,
  });

  const filename = `feuille_emargement_${sessionDate}.pdf`;
  return new Response(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
