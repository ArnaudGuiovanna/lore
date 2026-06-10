import Link from "next/link";
import { cohortForLearner, loadTenantContext } from "@/lib/tenant-context";
import { Metric } from "@/components/ui/Metric";
import { Pill } from "@/components/Mark";
import { fmtDate, fmtPct } from "@/lib/format";
import {
  activeLearner,
  conceptName,
  loadDomainGraph,
  loadStates,
} from "@/components/learner/data";
import { LearnerError, LearnerEmpty } from "@/components/learner/LearnerStatus";
import { LearnerAttestationButton } from "@/components/certificates/DownloadAttestation";
import { BOUND_SYLLABUS_TITLE, prerequisites, servesTrace } from "@/components/learner/lineage";
import type { LearnerState } from "@/lib/types";

export const dynamic = "force-dynamic";

// Calibration: agreement between confidence and demonstrated mastery. Honest gap,
// not a vanity bar. |confidence - mastery| small = well-calibrated.
function calibration(st: LearnerState): { gap: number; label: string } {
  const gap = Math.abs(st.confidence - st.mastery);
  const label = gap < 0.12 ? "calibré" : st.confidence > st.mastery ? "sur-confiant" : "sous-confiant";
  return { gap, label };
}

export default async function ProgressScreen() {
  const learner = await activeLearner();
  const [ctx, statesRes] = await Promise.all([
    loadTenantContext(),
    loadStates(learner.id),
  ]);
  const statesForDomain = statesRes.ok ? statesRes.data : [];
  const domainId = statesForDomain[0]?.domain_id || ctx.primaryDomain?.id || "";
  const graphRes = await loadDomainGraph(domainId);
  const cohortName = cohortForLearner(ctx, learner.id)?.name || ctx.primaryCohort?.name || "votre groupe";
  const syllabusTitle = ctx.primarySyllabus?.title || BOUND_SYLLABUS_TITLE;

  const header = (
    <div className="col" style={{ gap: 8 }}>
      <span className="kicker">Progression</span>
      <h1 className="standfirst">Votre parcours — et où vous en êtes.</h1>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <span className="mono quiet" style={{ fontSize: 11 }}>
          généré à partir du syllabus de {cohortName} · {syllabusTitle}
        </span>
      </div>
      <p className="soft" style={{ maxWidth: "62ch", fontSize: 14, lineHeight: 1.6 }}>
        Des signaux honnêtes uniquement — maîtrise, rétention et calibration tels que le runtime
        les évalue. Aucune barre de vanité.
      </p>
    </div>
  );

  if (!statesRes.ok) {
    return (
      <div className="col" style={{ gap: 22 }}>
        {header}
        <LearnerError
          detail="Nous n'avons pas pu joindre le runtime pour lire votre état ; il n'y a donc aucun signal à afficher. Nous n'en inventerons pas."
          message={statesRes.error}
        />
      </div>
    );
  }

  const states = statesRes.data;
  const graph = graphRes.ok ? graphRes.data : { concepts: [], dependencies: [] };
  const sorted = [...states].sort((a, b) => a.mastery - b.mastery);

  return (
    <div className="col" style={{ gap: 22 }}>
      {header}

      {sorted.length === 0 ? (
        <LearnerEmpty kicker="Aucun signal pour l'instant">
          Le runtime n&rsquo;a encore évalué aucun concept pour vous. Faites votre première
          étape sur <Link href="/learner" style={{ color: "var(--accent)" }}>Maintenant</Link> et
          votre maîtrise, votre rétention et votre calibration apparaîtront ici.
        </LearnerEmpty>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
          {sorted.map((st) => {
            const name = conceptName(graph.concepts, st.concept_id);
            const cal = calibration(st);
            const serves = servesTrace(graph.dependencies, graph.concepts, st.concept_id);
            const gates = prerequisites(graph.dependencies, st.concept_id).map((id) => ({
              id,
              name: conceptName(graph.concepts, id),
              mastered: (states.find((x) => x.concept_id === id)?.mastery ?? 0) >= 0.8,
            }));
            const locked = gates.filter((g) => !g.mastered);
            return (
              <section key={st.concept_id} className="panel col" style={{ gap: 14 }}>
                <div className="spread" style={{ flexWrap: "wrap", gap: 10, alignItems: "baseline" }}>
                  <h2 style={{ fontSize: 20 }}>{name}</h2>
                  <Pill on={st.card_state === "review"}>{st.card_state}</Pill>
                </div>
                <p className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "baseline", margin: 0 }}>
                  <span className="kicker" style={{ fontSize: 9 }}>
                    sert
                  </span>
                  <Pill on={serves.kind === "objective"}>{serves.pill}</Pill>
                  <span className="soft" style={{ fontSize: 13, fontStyle: "italic" }}>
                    → {serves.note}
                  </span>
                </p>
                <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
                  <Metric
                    label="maîtrise"
                    value={fmtPct(st.mastery)}
                    tone={st.mastery >= 0.8 ? "accent" : "ink"}
                  />
                  <Metric
                    label="rétention"
                    value={fmtPct(st.retention)}
                    tone={st.retention < 0.5 ? "amber" : "ink"}
                  />
                  <Metric
                    label="calibration"
                    value={cal.label}
                    hint={`écart ${cal.gap.toFixed(2)}`}
                    tone={cal.label === "calibré" ? "accent" : "amber"}
                  />
                  <Metric label="répét. · oublis" value={`${st.reps} · ${st.lapses}`} />
                  <Metric label="prochaine révision" value={fmtDate(st.due_at)} />
                </div>
                {locked.length ? (
                  <p className="soft" style={{ fontSize: 13 }}>
                    Prérequis ajouté{locked.length > 1 ? "s" : ""} par le runtime :{" "}
                    {locked.map((g) => (
                      <Pill key={g.id}>{g.name} · verrouillé</Pill>
                    ))}
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      {sorted.length ? (
        <div
          className="col"
          style={{ gap: 12, borderTop: "1px solid var(--line)", paddingTop: 14 }}
        >
          <p className="soft" style={{ fontSize: 13, margin: 0 }}>
            Une partie du travail correspond à l&apos;entretien de la rétention que le runtime a
            planifié en dehors d&apos;un objectif précis — affiché honnêtement plutôt que masqué.
          </p>
          {/* Real progress exists (>= 1 tracked concept): offer the OF attestation
              (attestation de fin de formation) as a downloadable PDF. */}
          <div className="col" style={{ gap: 6 }}>
            <LearnerAttestationButton learnerId={learner.id} />
            <span className="quiet mono" style={{ fontSize: 11 }}>
              Attestation de fin de formation — niveaux de maîtrise tels que mesurés par le moteur.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
