import Link from "next/link";
import { listCredentials } from "@/lib/auth/store";
import { getAttendance, listSessions } from "@/lib/attendance/store";
import { learnersForCohort, loadTenantContext } from "@/lib/tenant-context";
import { Emargement, type RosterEntry } from "@/components/trainer/Emargement";

export const dynamic = "force-dynamic";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Trainer émargement surface: pick a cohort session date and mark each enrolled
// learner present/absent. The roster comes from backend learner/enrollment lists.
export default async function EmargementPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const ctx = await loadTenantContext();
  const cohort = ctx.primaryCohort;
  const cohortId = cohort?.id ?? "";
  const cohortName = cohort?.name ?? "groupe";
  const rosterLearners = learnersForCohort(ctx, cohortId);
  const sp = await searchParams;
  const rawDate = (sp.date || "").trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : today();

  // Human names: credential store first, then the backend learner list.
  const creds = await listCredentials();
  const nameFor = (id: string): string =>
    creds.find((c) => c.userId === id)?.name ?? rosterLearners.find((l) => l.user_id === id)?.name ?? id;

  // Existing persisted presence for the selected date (pre-fill the toggles).
  const existing = cohortId ? await getAttendance(cohortId, date) : [];
  const byLearner = new Map(existing.map((r) => [r.learnerId, r]));

  const roster: RosterEntry[] = rosterLearners
    .map((learner): RosterEntry => {
      const rec = byLearner.get(learner.user_id);
      return {
        learnerId: learner.user_id,
        name: nameFor(learner.user_id),
        present: rec ? rec.present : null,
        signedAt: rec?.signedAt ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

  const pastSessions = cohortId ? await listSessions(cohortId) : [];

  return (
    <main style={{ minHeight: "100vh" }}>
      <div className="wrap" style={{ paddingTop: 28, paddingBottom: 80 }}>
        <div className="spread" style={{ marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
          <Link href="/trainer" className="mono quiet" style={{ fontSize: 12 }}>
            ← Console formateur
          </Link>
          <span className="mono quiet" style={{ fontSize: 11, letterSpacing: "0.05em" }}>
            tenant {ctx.tenantSlug} · TRAINER · émargement
          </span>
        </div>

        <header className="col" style={{ gap: 6, marginBottom: 22 }}>
          <span className="kicker">Émargement / Attendance</span>
          <h1 className="standfirst" style={{ margin: 0 }}>Feuilles de présence</h1>
        </header>

        <Emargement
          cohortId={cohortId}
          cohortName={cohortName}
          initialDate={date}
          roster={roster}
          pastSessions={pastSessions}
        />
      </div>
    </main>
  );
}
