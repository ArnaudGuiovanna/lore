import { api, tpath } from "@/lib/api";
import { cohortForLearner, loadTenantContext } from "@/lib/tenant-context";
import { activeLearner } from "@/components/learner/data";
import { LearnerEmpty, LearnerError } from "@/components/learner/LearnerStatus";
import { Pill } from "@/components/Mark";
import type { TrainingSession } from "@/lib/types";

export const dynamic = "force-dynamic";

function dayKey(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Agenda apprenant (B-25) : the tenant's planned sessions, grouped by day,
// with the modality (lieu / visio) and an ICS export. Read-only — the admin
// plans, the trainer signs (émargement), the learner attends.
export default async function AgendaScreen() {
  const learner = await activeLearner();
  const [ctx, sessionsRes] = await Promise.all([
    loadTenantContext(),
    api.get<TrainingSession[]>(tpath("/training-sessions")),
  ]);
  const cohort = cohortForLearner(ctx, learner.id);
  const icsHref = cohort
    ? `/api/sessions/ics?cohortId=${encodeURIComponent(cohort.id)}`
    : "/api/sessions/ics";

  const header = (
    <div className="col" style={{ gap: 8 }}>
      <span className="kicker">Agenda</span>
      <h1 className="standfirst" data-testid="agenda-title">
        Vos sessions planifiées.
      </h1>
      <p className="soft" style={{ maxWidth: "62ch", fontSize: 14, lineHeight: 1.6 }}>
        Les séances présentielles et à distance planifiées par votre organisme — avec le lieu
        ou le lien visio, et un export vers votre propre calendrier.
      </p>
    </div>
  );

  if (!sessionsRes.ok) {
    return (
      <div className="col" style={{ gap: 22 }}>
        {header}
        <LearnerError
          detail="Nous n'avons pas pu lire les sessions planifiées ; rien n'est inventé pour combler le manque. Les sessions existent toujours sur le backend — ceci n'est qu'une lecture."
          message={sessionsRes.error}
        />
      </div>
    );
  }

  const sessions = (Array.isArray(sessionsRes.data) ? sessionsRes.data : [])
    .filter((s) => s.status !== "ARCHIVED" && !s.archived_at)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));

  if (sessions.length === 0) {
    return (
      <div className="col" style={{ gap: 22 }}>
        {header}
        <LearnerEmpty kicker="Aucune session planifiée">
          Aucune séance n&apos;est encore au calendrier pour votre organisme. Quand
          l&apos;administration planifiera des sessions, elles apparaîtront ici — datées,
          avec leur lieu ou leur lien visio.
        </LearnerEmpty>
      </div>
    );
  }

  const cohortName = (id: string) => ctx.cohorts.find((c) => c.id === id)?.name ?? id.slice(0, 8);
  const days = new Map<string, TrainingSession[]>();
  for (const s of sessions) {
    const k = dayKey(s.starts_at);
    days.set(k, [...(days.get(k) ?? []), s]);
  }

  return (
    <div className="col" style={{ gap: 22 }}>
      {header}
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <a className="btn ghost" href={icsHref} style={{ textDecoration: "none" }}>
          ↓ ajouter à mon calendrier (ICS)
        </a>
        <span className="quiet mono" style={{ fontSize: 11, alignSelf: "center" }}>
          format iCalendar — compatible avec tout client d&apos;agenda
        </span>
      </div>
      {[...days.entries()].map(([k, group]) => (
        <section key={k} className="panel col" style={{ gap: 14 }}>
          <h2 style={{ fontSize: 18, textTransform: "capitalize" }}>{fmtDay(group[0].starts_at)}</h2>
          <div className="col" style={{ gap: 12 }}>
            {group.map((s) => (
              <div
                key={s.id}
                className="spread"
                style={{ gap: 12, flexWrap: "wrap", alignItems: "baseline", borderTop: "1px solid var(--line)", paddingTop: 12 }}
              >
                <div className="col" style={{ gap: 4 }}>
                  <strong style={{ fontSize: 15 }}>{s.title}</strong>
                  <span className="mono quiet" style={{ fontSize: 11 }}>
                    {fmtTime(s.starts_at)} – {fmtTime(s.ends_at)} · {cohortName(s.cohort_id)}
                  </span>
                </div>
                {s.video_url ? (
                  <a
                    className="btn primary"
                    href={s.video_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: "none", fontSize: 13 }}
                  >
                    rejoindre la visio ↗
                  </a>
                ) : (
                  <Pill>{s.location || "présentiel"}</Pill>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
