import Link from "next/link";
import { loadTenantContext } from "@/lib/tenant-context";
import {
  activeLearner,
  conceptName,
  focusState,
  getDomainGraph,
  getSnapshots,
  loadStates,
} from "@/components/learner/data";
import { LearnerError, LearnerEmpty } from "@/components/learner/LearnerStatus";
import { BOUND_SYLLABUS_TITLE } from "@/components/learner/lineage";
import { NowWorkbench, type NowIntent } from "@/components/learner/NowWorkbench";

export const dynamic = "force-dynamic";

// Read the latest misconception the runtime observed for this concept, without
// re-planning (activities/next mutates state). Snapshots carry observation +
// decision, so we read the runtime's own trace.
function latestMisconception(
  snapshots: Awaited<ReturnType<typeof getSnapshots>>,
  conceptId: string
): string | undefined {
  for (const s of snapshots) {
    if (s.concept_id !== conceptId) continue;
    const obs = s.observation as Record<string, unknown> | undefined;
    const et = obs?.["error_type"];
    if (typeof et === "string" && et) return et;
  }
  return undefined;
}

export default async function NowScreen() {
  const learner = await activeLearner();
  const [ctx, statesRes, snapshots] = await Promise.all([
    loadTenantContext(),
    loadStates(learner.id),
    getSnapshots(learner.id),
  ]);

  if (!statesRes.ok) {
    return (
      <LearnerError
        kicker="Le runtime n'a pas répondu"
        detail="Nous n'avons pas pu joindre le runtime pour planifier votre prochaine étape. Nous n'en inventerons pas — réessayez dans un instant."
        message={statesRes.error}
      />
    );
  }

  const focus = focusState(statesRes.data);

  if (!focus) {
    return (
      <LearnerEmpty kicker="Maintenant">
        Aucun concept suivi pour l&rsquo;instant. Dès que le runtime aura planifié votre première
        étape, elle apparaîtra ici — la progression relève de lui, jamais du contenu.
      </LearnerEmpty>
    );
  }

  const domainId = focus.domain_id || ctx.primaryDomain?.id || "";
  const graph = await getDomainGraph(domainId);
  const name = conceptName(graph.concepts, focus.concept_id);
  const misconception = latestMisconception(snapshots, focus.concept_id);
  const syllabusTitle = ctx.primarySyllabus?.title || BOUND_SYLLABUS_TITLE;

  const rationaleParts = [
    `La rétention est de ${(focus.retention * 100).toFixed(0)} %`,
    focus.lapses > 0 ? `${focus.lapses} oubli${focus.lapses > 1 ? "s" : ""} enregistré${focus.lapses > 1 ? "s" : ""}` : null,
    focus.card_state ? `la carte est ${focus.card_state}` : null,
    misconception ? `une conception erronée active (${misconception}) bloque la progression` : null,
  ].filter(Boolean);

  const intent: NowIntent = {
    conceptId: focus.concept_id,
    conceptName: name,
    activityType: misconception ? "DEBUG_MISCONCEPTION" : "GUIDED_PRACTICE",
    rationale: `${rationaleParts.join(" · ")}. Le runtime vous maintient ici pour corriger cela avant d'avancer.`,
    difficultyTarget: focus.difficulty / 10,
    misconception,
  };

  return (
    <div className="col" style={{ gap: 24 }}>
      <div
        className="spread"
        style={{
          flexWrap: "wrap",
          gap: 10,
          padding: "10px 14px",
          border: "1px solid var(--line)",
          borderRadius: 999,
        }}
      >
        <span className="mono quiet" style={{ fontSize: 11 }} data-testid="now-syllabus-line">
          issu du syllabus de votre groupe · {syllabusTitle}
        </span>
        <Link
          href="/learner/provenance"
          className="mono"
          style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}
          data-testid="why-this-path"
        >
          › pourquoi ce parcours ?
        </Link>
      </div>

      <NowWorkbench
        learnerId={learner.id}
        domainId={domainId}
        intent={intent}
        initialState={focus}
      />
    </div>
  );
}
