import Link from "next/link";
import { loadTenantContext } from "@/lib/tenant-context";
import { loadLearnerPath, resolvePrimarySyllabus } from "@/lib/learner-path";
import { activeLearner } from "@/components/learner/data";
import { LearnerEmpty, LearnerError } from "@/components/learner/LearnerStatus";
import { Metric } from "@/components/ui/Metric";
import { Pill } from "@/components/Mark";
import { fmtPct } from "@/lib/format";
import type { ModuleStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

// Status rendering — French, sober, evidence-first. LOCKED is a real lock
// (prerequisite modules not yet completed), COMPLETED is runtime-measured mastery.
const STATUS: Record<ModuleStatus, { label: string; on: boolean }> = {
  LOCKED: { label: "🔒 verrouillé", on: false },
  AVAILABLE: { label: "disponible", on: false },
  IN_PROGRESS: { label: "en cours", on: true },
  COMPLETED: { label: "✓ terminé", on: true },
};

export default async function PathScreen() {
  const learner = await activeLearner();
  const ctx = await loadTenantContext();
  // A learner token cannot list /syllabi, so ctx.primarySyllabus is often empty
  // on this surface — fall back to the shared server-only resolution (same rule).
  const syllabus = ctx.primarySyllabus
    ? { id: ctx.primarySyllabus.id, title: ctx.primarySyllabus.title }
    : await resolvePrimarySyllabus();
  const pathRes = syllabus
    ? await loadLearnerPath(learner.id, syllabus.id)
    : ({ ok: true, data: [] } as const);

  const header = (
    <div className="col" style={{ gap: 8 }}>
      <span className="kicker">Parcours</span>
      <h1 className="standfirst" data-testid="path-title">
        Vos modules — et ce qui se débloque.
      </h1>
      <p className="soft" style={{ maxWidth: "62ch", fontSize: 14, lineHeight: 1.6 }}>
        Votre formateur peut séquencer le syllabus en modules ordonnés. Un module se termine
        par la preuve — la maîtrise mesurée par le runtime — jamais par un simple clic.
      </p>
      {syllabus ? (
        <span className="mono quiet" style={{ fontSize: 11 }}>
          syllabus · {syllabus.title}
        </span>
      ) : null}
    </div>
  );

  if (!pathRes.ok) {
    return (
      <div className="col" style={{ gap: 22 }}>
        {header}
        <LearnerError
          detail="Nous n'avons pas pu lire votre parcours sur le runtime ; rien n'est inventé pour combler le manque. Votre progression est en sécurité sur le backend — ceci n'est qu'une lecture."
          message={pathRes.error}
        />
      </div>
    );
  }

  const rows = pathRes.data;
  if (rows.length === 0) {
    return (
      <div className="col" style={{ gap: 22 }}>
        {header}
        <LearnerEmpty kicker="Aucun module pour l'instant">
          Votre formateur n&apos;a pas encore séquencé le parcours en modules — le runtime pilote
          donc librement votre progression sur tout le graphe du domaine. Continuez sur{" "}
          <Link href="/learner" style={{ color: "var(--accent)" }}>Maintenant</Link> ; si des
          modules apparaissent, leur déblocage s&apos;affichera ici.
        </LearnerEmpty>
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 22 }}>
      {header}
      <ol className="col" style={{ gap: 14, listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map((row, i) => {
          const st = STATUS[row.status] ?? STATUS.AVAILABLE;
          const locked = row.status === "LOCKED";
          const ratio = row.concepts_total > 0 ? row.concepts_mastered / row.concepts_total : 0;
          return (
            <li key={row.module.id}>
              <section
                className="panel col"
                style={{ gap: 12, opacity: locked ? 0.62 : 1 }}
                aria-label={`Module ${row.module.position} · ${row.module.title}`}
              >
                <div className="spread" style={{ flexWrap: "wrap", gap: 10, alignItems: "baseline" }}>
                  <div className="row" style={{ gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span className="mono quiet" style={{ fontSize: 11 }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h2 style={{ fontSize: 20 }}>{row.module.title}</h2>
                  </div>
                  <Pill on={st.on}>{st.label}</Pill>
                </div>
                {row.module.description ? (
                  <p className="soft" style={{ fontSize: 14, lineHeight: 1.6, margin: 0, maxWidth: "62ch" }}>
                    {row.module.description}
                  </p>
                ) : null}
                {/* Honest progress: mastered concepts over total, at the module's own threshold. */}
                <div className="col" style={{ gap: 6, maxWidth: 420 }}>
                  <div
                    aria-hidden="true"
                    style={{
                      height: 6,
                      borderRadius: 3,
                      background: "var(--line)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.round(ratio * 100)}%`,
                        height: "100%",
                        background: "var(--accent)",
                      }}
                    />
                  </div>
                  <span className="mono quiet" style={{ fontSize: 11 }}>
                    {row.concepts_mastered}/{row.concepts_total} concept
                    {row.concepts_total > 1 ? "s" : ""} maîtrisé{row.concepts_mastered > 1 ? "s" : ""} · seuil{" "}
                    {fmtPct(row.module.required_mastery)}
                  </span>
                </div>
                <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
                  <Metric
                    label="maîtrise moyenne"
                    value={fmtPct(row.avg_mastery)}
                    tone={row.status === "COMPLETED" ? "accent" : "ink"}
                  />
                  <Metric label="position" value={row.module.position} />
                </div>
                {locked ? (
                  <p className="quiet mono" style={{ fontSize: 11, margin: 0 }}>
                    se débloque quand les modules prérequis sont terminés (preuve de maîtrise, pas de clic).
                  </p>
                ) : null}
              </section>
            </li>
          );
        })}
      </ol>
      <p className="soft" style={{ fontSize: 13, lineHeight: 1.6, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
        À l&apos;intérieur d&apos;un module débloqué, c&apos;est toujours le runtime qui choisit la
        prochaine étape — le séquencement du formateur fixe le cadre, jamais l&apos;activité.
      </p>
    </div>
  );
}
