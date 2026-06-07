import Link from "next/link";
import { api, tpath } from "@/lib/api";
import { seed } from "@/lib/config";
import { listCredentials } from "@/lib/auth/store";
import { getAttendance, listSessions } from "@/lib/attendance/store";
import type { LoreEvent } from "@/lib/types";
import { Emargement, type RosterEntry } from "@/components/trainer/Emargement";

export const dynamic = "force-dynamic";

type RawEvent = LoreEvent & { occurred_at?: string };

function asArray<T>(r: { ok: boolean; data?: unknown }): T[] {
  return r.ok && Array.isArray(r.data) ? (r.data as T[]) : [];
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Trainer émargement surface: pick a cohort session date and mark each enrolled
// learner present/absent. The roster is the seeded learners joined with any live
// LearnerEnrolled events for the cohort (the backend has no GET for enrollment).
export default async function EmargementPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const s = seed();
  const sp = await searchParams;
  const rawDate = (sp.date || "").trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : today();

  // Enrolled ids = seeded learners ∪ anyone in a LearnerEnrolled event for this cohort.
  const outboxRes = await api.get<RawEvent[]>(tpath("/events/outbox"));
  const enrolledIds = new Set<string>(s.learners.map((l) => l.id));
  for (const e of asArray<RawEvent>(outboxRes)) {
    if (e.event_type === "LearnerEnrolled") {
      const p = e.payload as { cohort_id?: string; learner_id?: string };
      if (p?.cohort_id === s.cohortId && p?.learner_id) enrolledIds.add(p.learner_id);
    }
  }

  // Human names: credential store first, then the seeded roster.
  const creds = await listCredentials();
  const nameFor = (id: string): string =>
    creds.find((c) => c.userId === id)?.name ?? s.learners.find((l) => l.id === id)?.name ?? id;

  // Existing persisted presence for the selected date (pre-fill the toggles).
  const existing = await getAttendance(s.cohortId, date);
  const byLearner = new Map(existing.map((r) => [r.learnerId, r]));

  const roster: RosterEntry[] = Array.from(enrolledIds)
    .map((id): RosterEntry => {
      const rec = byLearner.get(id);
      return {
        learnerId: id,
        name: nameFor(id),
        present: rec ? rec.present : null,
        signedAt: rec?.signedAt ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

  const pastSessions = await listSessions(s.cohortId);

  return (
    <main style={{ minHeight: "100vh" }}>
      <div className="wrap" style={{ paddingTop: 28, paddingBottom: 80 }}>
        <div className="spread" style={{ marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
          <Link href="/trainer" className="mono quiet" style={{ fontSize: 12 }}>
            ← Console formateur
          </Link>
          <span className="mono quiet" style={{ fontSize: 11, letterSpacing: "0.05em" }}>
            tenant {s.tenantSlug} · TRAINER · émargement
          </span>
        </div>

        <header className="col" style={{ gap: 6, marginBottom: 22 }}>
          <span className="kicker">Émargement / Attendance</span>
          <h1 className="standfirst" style={{ margin: 0 }}>Feuilles de présence</h1>
        </header>

        <Emargement
          cohortId={s.cohortId}
          cohortName={s.cohortName}
          initialDate={date}
          roster={roster}
          pastSessions={pastSessions}
        />
      </div>
    </main>
  );
}
