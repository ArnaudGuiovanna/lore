// GET /api/certificates?learnerId=... — stream a completion attestation PDF.
//
// Authorization (enforced here AND end-to-end by the backend, since the per-user
// LORE bearer token is attached on tenant-scoped reads):
//   - a LEARNER may only fetch THEIR OWN attestation (learnerId === session.userId);
//   - a TRAINER or TENANT_ADMIN/SUPER_ADMIN may fetch any learner in their tenant
//     (the backend's RBAC further confines reads to learners they manage).
// Anything else is rejected with 403.
//
// Data is REAL: the learner's durable state comes from
// GET /v1/tenants/{t}/learners/{l}/state, concept names from the domain graph, the
// program title from the cohort's bound syllabus, and the org name from the tenant.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { seed } from "@/lib/config";
import { getStates, getDomainGraph, conceptName } from "@/components/learner/data";
import { BOUND_SYLLABUS_TITLE } from "@/components/learner/lineage";
import {
  buildCertificatePdf,
  attestationFilename,
  type CertificateConcept,
} from "@/lib/pdf/certificate";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const learnerId = (url.searchParams.get("learnerId") || "").trim();
  if (!learnerId) {
    return NextResponse.json({ error: "learnerId required" }, { status: 400 });
  }

  // Authorization boundary. A learner is confined to their own id; staff roles may
  // read learners in their tenant (the backend token enforces the tenant scope).
  const isSelf = session.userId === learnerId;
  const isStaff =
    session.role === "TRAINER" ||
    session.role === "TENANT_ADMIN" ||
    session.role === "SUPER_ADMIN";
  if (!isSelf && !isStaff) {
    return NextResponse.json(
      { error: "you may only download your own attestation" },
      { status: 403 }
    );
  }

  const s = seed();

  // Real reads. The bearer token on these tenant-scoped calls is the authenticated
  // user's, so the backend independently authorizes the access (defence in depth).
  const [states, graph] = await Promise.all([
    getStates(learnerId),
    getDomainGraph(s.domainId),
  ]);

  // Honest concept lines, sorted most-mastered first (the strongest evidence leads).
  const concepts: CertificateConcept[] = states
    .map((st) => ({
      name: conceptName(graph.concepts, st.concept_id),
      mastery: st.mastery,
      retention: st.retention,
    }))
    .sort((a, b) => b.mastery - a.mastery);

  // The learner's display name: their own session name when self, else the seeded
  // roster name (the trainer/admin roster the staff member is acting from).
  const learnerName = isSelf
    ? session.name || "Apprenant"
    : s.learners.find((l) => l.id === learnerId)?.name || learnerId;

  // Period: earliest → latest interaction the runtime recorded, when available.
  const interactionTimes = states
    .map((st) => st.last_interaction_at)
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .sort();
  const periodStart = interactionTimes[0] ?? null;
  const periodEnd = interactionTimes[interactionTimes.length - 1] ?? null;

  const pdfBytes = await buildCertificatePdf({
    organizationName: s.tenantName,
    learnerName,
    learnerId,
    tenantId: s.tenantId,
    programTitle: BOUND_SYLLABUS_TITLE,
    periodStart,
    periodEnd,
    concepts,
  });

  const filename = attestationFilename(learnerName);
  // Copy into a fresh ArrayBuffer-backed Uint8Array for a clean BodyInit.
  const body = new Uint8Array(pdfBytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
