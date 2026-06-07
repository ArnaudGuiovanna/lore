import Link from "next/link";
import { seed } from "@/lib/config";
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
  const s = seed();
  const learner = await activeLearner();
  const [statesRes, graph, snapshots] = await Promise.all([
    loadStates(learner.id),
    getDomainGraph(s.domainId),
    getSnapshots(learner.id),
  ]);

  if (!statesRes.ok) {
    return (
      <LearnerError
        kicker="The runtime didn't answer"
        detail="We couldn't reach the runtime to plan your next step. We won't fabricate one — try again in a moment."
        message={statesRes.error}
      />
    );
  }

  const focus = focusState(statesRes.data);

  if (!focus) {
    return (
      <LearnerEmpty kicker="Now">
        No tracked concepts yet. Once the runtime plans your first step it will
        appear here — progression is its call, never the content&rsquo;s.
      </LearnerEmpty>
    );
  }

  const name = conceptName(graph.concepts, focus.concept_id);
  const misconception = latestMisconception(snapshots, focus.concept_id);

  const rationaleParts = [
    `Retention is ${(focus.retention * 100).toFixed(0)}%`,
    focus.lapses > 0 ? `${focus.lapses} lapse${focus.lapses > 1 ? "s" : ""} recorded` : null,
    focus.card_state ? `card is ${focus.card_state}` : null,
    misconception ? `an active misconception (${misconception}) is gating progress` : null,
  ].filter(Boolean);

  const intent: NowIntent = {
    conceptId: focus.concept_id,
    conceptName: name,
    activityType: misconception ? "DEBUG_MISCONCEPTION" : "GUIDED_PRACTICE",
    rationale: `${rationaleParts.join(" · ")}. The runtime is holding you here to repair it before advancing.`,
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
        <span className="mono quiet" style={{ fontSize: 11 }}>
          from your cohort’s syllabus · {BOUND_SYLLABUS_TITLE}
        </span>
        <Link
          href="/learner/provenance"
          className="mono"
          style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}
        >
          › why this path?
        </Link>
      </div>

      <NowWorkbench
        learnerId={learner.id}
        domainId={s.domainId}
        intent={intent}
        initialState={focus}
      />
    </div>
  );
}
