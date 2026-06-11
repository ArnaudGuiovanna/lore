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
import { NowWorkbench, type NowIntent } from "@/components/learner/NowWorkbench";
import { AnnouncementsStrip } from "@/components/learner/AnnouncementsStrip";

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
      <div className="col" style={{ gap: 24 }}>
        {/* B-18 : les annonces restent lisibles même si le runtime n'a pas répondu. */}
        <AnnouncementsStrip />
        <LearnerError
          kicker="Le runtime n'a pas répondu"
          detail="Nous n'avons pas pu joindre le runtime pour planifier votre prochaine étape. Nous n'en inventerons pas — réessayez dans un instant."
          message={statesRes.error}
        />
      </div>
    );
  }

  const focus = focusState(statesRes.data);

  if (!focus) {
    return (
      <div className="col" style={{ gap: 24 }}>
        <AnnouncementsStrip />
        <LearnerEmpty kicker="Maintenant">
          Aucun concept suivi pour l&rsquo;instant. Dès que le runtime aura planifié votre première
          étape, elle apparaîtra ici — la progression relève de lui, jamais du contenu.
        </LearnerEmpty>
      </div>
    );
  }

  const domainId = focus.domain_id || ctx.primaryDomain?.id || "";
  const graph = await getDomainGraph(domainId);
  const name = conceptName(graph.concepts, focus.concept_id);
  const misconception = latestMisconception(snapshots, focus.concept_id);

  // The runtime's decision, composed server-side as ONE human sentence.
  // Neutral by default; corrective tone only when something was actually missed.
  const corrective = Boolean(misconception) || focus.lapses > 0;
  const sentence = `${corrective ? "Reprendre" : "Aujourd'hui :"} ${name.toLowerCase()}.`;
  const rationale = misconception
    ? "Une difficulté repérée lors de votre dernière tentative bloque encore ce point — on le reprend ensemble."
    : focus.lapses > 0
      ? "Vous l'aviez oublié récemment — on le consolide avant d'avancer."
      : "C'est la prochaine étape de votre parcours.";

  const intent: NowIntent = {
    conceptId: focus.concept_id,
    conceptName: name,
    activityType: misconception ? "DEBUG_MISCONCEPTION" : "GUIDED_PRACTICE",
    sentence,
    rationale,
    difficultyTarget: focus.difficulty / 10,
    misconception,
  };

  return (
    <div className="col" style={{ gap: 24 }}>
      <NowWorkbench
        learnerId={learner.id}
        domainId={domainId}
        intent={intent}
        initialState={focus}
      />
      {/* B-18 : les annonces existent sans pousser la décision sous le pli. */}
      <AnnouncementsStrip />
    </div>
  );
}
