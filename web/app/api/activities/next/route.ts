import { NextResponse } from "next/server";
import { api, tpath } from "@/lib/api";
import { allowedConceptIdsForLearner } from "@/lib/learner-path";
import type { GeneratedContent, PlanNextResponse } from "@/lib/types";

interface Body {
  learnerId: string;
  domainId: string;
}

function instructionIdFrom(decision: PlanNextResponse): string {
  return (
    decision.tutor_instruction?.id ||
    decision.instruction?.id ||
    decision.activity?.instruction_id ||
    ""
  );
}

// POST {learnerId, domainId}: ask the runtime to plan the next activity, then
// request the learner-facing content for the returned TutorInstruction when the
// backend exposes generation. Planning remains authoritative if generation fails.
export async function POST(req: Request) {
  const { learnerId, domainId } = (await req.json()) as Body;

  // B-24 gating: when the trainer has sequenced the primary syllabus into
  // modules, restrict the runtime to the concepts of the non-LOCKED modules.
  // Honest fallback: if no module exists, or if the path/syllabus read fails
  // for any reason, we plan WITHOUT restriction (legacy behavior) — the gating
  // is an editorial overlay and must never block a learner from working.
  const allowed = await allowedConceptIdsForLearner(learnerId);
  const planBody: Record<string, unknown> = { domain_id: domainId };
  if (allowed && allowed.length > 0) planBody.allowed_concept_ids = allowed;

  const r = await api.post<PlanNextResponse>(
    tpath(`/learners/${learnerId}/activities/next`),
    planBody
  );
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  const instructionId = instructionIdFrom(r.data);
  if (!instructionId) return NextResponse.json(r.data, { status: 200 });

  const generated = await api.post<GeneratedContent>(tpath(`/tutor-instructions/${instructionId}/generate`), {});
  if (generated.ok) {
    return NextResponse.json({ ...r.data, generated_content: generated.data }, { status: 200 });
  }

  return NextResponse.json(
    {
      ...r.data,
      generated_content_error: { status: generated.status, error: generated.error },
    },
    { status: 200 }
  );
}
