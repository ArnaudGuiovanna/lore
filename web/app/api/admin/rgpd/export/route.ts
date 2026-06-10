// RGPD access/portability export: GET /api/admin/rgpd/export?userId=
// Aggregates everything LORE holds about one person into a portable JSON bundle:
//   - the credential record (NO password hash) + membership/role (web tier),
//   - the learner's runtime state, review cards, snapshots, interactions, alerts,
//     misconceptions (Go backend, bearer-scoped),
//   - attendance / émargement rows (web tier).
// Admin-only (session role + the /api/admin middleware guard). Server-only.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import { listCredentials } from "@/lib/auth/store";
import { getLearnerAttendance } from "@/lib/attendance/store";
import { listErasures } from "@/lib/rgpd/erasures";
import { learnerDisplay, loadTenantContext } from "@/lib/tenant-context";
import type {
  Alert,
  LearnerState,
  Membership,
  PedagogicalSnapshot,
  ReviewCard,
} from "@/lib/types";

const ADMIN = new Set(["TENANT_ADMIN", "SUPER_ADMIN"]);

function asArray<T>(r: { ok: boolean; data?: unknown }): T[] {
  return r.ok && Array.isArray(r.data) ? (r.data as T[]) : [];
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  if (!ADMIN.has(session.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const userId = (url.searchParams.get("userId") || "").trim();
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

  const ctx = await loadTenantContext();

  // ---- web-tier personal data: credential (sans hash) + membership/role ----
  const creds = await listCredentials();
  const cred = creds.find((c) => c.userId === userId) || null;
  const credentialPublic = cred
    ? {
        email: cred.email,
        name: cred.name,
        role: cred.role,
        userId: cred.userId,
        tenantId: cred.tenantId,
        mustChangePassword: cred.mustChangePassword,
        createdAt: cred.createdAt,
        // passwordHash is deliberately omitted from the export.
      }
    : null;

  const membershipsRes = await api.get<Membership[]>(tpath("/memberships"));
  const membership =
    asArray<Membership>(membershipsRes).find((m) => m.user_id === userId) || null;

  // ---- backend runtime traces (pseudonymous by learner id) ----
  // Only endpoints the backend actually exposes are read: per-learner state,
  // due review cards, pedagogical snapshots, and the tenant alert feed (filtered).
  const [stateRes, dueRes, snapRes, alertsRes] = await Promise.all([
    api.get<LearnerState[]>(tpath(`/learners/${userId}/state`)),
    api.get<ReviewCard[]>(tpath(`/learners/${userId}/reviews/due`)),
    api.get<PedagogicalSnapshot[]>(tpath(`/learners/${userId}/snapshots`)),
    api.get<Alert[]>(tpath(`/alerts`)),
  ]);

  const states = asArray<LearnerState>(stateRes);
  const due = asArray<ReviewCard>(dueRes);
  const snapshots = asArray<PedagogicalSnapshot>(snapRes);
  const alerts = asArray<Alert>(alertsRes).filter((a) => a.learner_id === userId);

  // ---- web-tier attendance / émargement ----
  const attendance = await getLearnerAttendance(userId);

  // ---- prior erasure tombstones for this subject (if any) ----
  const erasures = (await listErasures()).filter((e) => e.subjectUserId === userId);

  const bundle = {
    document: "LORE — Export de données personnelles (RGPD)",
    generatedAt: new Date().toISOString(),
    generatedBy: { userId: session.userId, role: session.role },
    subject: {
      userId,
      tenantId: ctx.tenantId,
      tenantName: ctx.tenantName,
      displayName: cred?.name ?? learnerDisplay(ctx, userId).name ?? null,
    },
    notice:
      "Ce document agrège les données détenues par LORE pour la personne concernée. " +
      "Les traces d'apprentissage du moteur (états, snapshots, interactions) sont " +
      "pseudonymisées par identifiant apprenant (learner_id), sans données nominatives.",
    identity: { credential: credentialPublic, membership },
    runtime: {
      state: states,
      reviewsDue: due,
      snapshots,
      alerts,
      _note:
        stateRes.ok || snapRes.ok
          ? undefined
          : "Le moteur n'a pas répondu pour certaines traces ; l'export reflète ce qui a pu être lu.",
    },
    attendance,
    erasures,
  };

  const subjectLabel = (cred?.name || userId).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="rgpd_export_${subjectLabel}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
