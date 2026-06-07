// RGPD erasure (right to be forgotten): POST /api/admin/rgpd/erase { userId }
// Anonymizes the personal data LORE controls in the WEB tier:
//   - the credential record (email/name redacted, password scrambled, row kept),
//   - the learner's attendance / émargement rows (re-keyed to a pseudonym, kept),
// and records an erasure tombstone for the audit trail.
//
// Honesty: the Go backend's runtime traces (states, snapshots) are keyed by learner
// id and are already pseudonymous — they carry no nominative data. We do NOT delete
// them here (the backend owns them and exposes no erase endpoint); the export bundle
// and this UI are explicit that those rows persist pseudonymously by learner id.
// Admin-only (session role + the /api/admin middleware guard). Server-only.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { anonymizeCredential } from "@/lib/auth/store";
import { anonymizeLearnerAttendance } from "@/lib/attendance/store";
import { recordErasure } from "@/lib/rgpd/erasures";

interface Body {
  userId?: string;
}

const ADMIN = new Set(["TENANT_ADMIN", "SUPER_ADMIN"]);

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  if (!ADMIN.has(session.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json()) as Body;
  const userId = (body.userId || "").trim();
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

  // An admin cannot erase themselves (would lock the operator out + break the audit).
  if (userId === session.userId) {
    return NextResponse.json({ error: "you cannot erase your own account" }, { status: 400 });
  }

  // 1) anonymize the credential (email/name → redacted, keep the row).
  const redactedEmail = await anonymizeCredential(userId);
  // 2) re-key the learner's attendance rows to a pseudonym (keep the rows).
  const attendanceRows = await anonymizeLearnerAttendance(userId);

  // 3) leave a tombstone proving the erasure happened (no nominative data).
  const tombstone = await recordErasure({
    subjectUserId: userId,
    actorUserId: session.userId,
    redactedEmail,
    attendanceRowsAnonymized: attendanceRows,
    credentialAnonymized: redactedEmail !== null,
  });

  return NextResponse.json(
    {
      ok: true,
      subjectUserId: userId,
      credentialAnonymized: redactedEmail !== null,
      redactedEmail,
      attendanceRowsAnonymized: attendanceRows,
      tombstoneId: tombstone.id,
      note:
        "Données nominatives anonymisées (identifiant de connexion + émargement). " +
        "Les traces du moteur restent pseudonymisées par identifiant apprenant.",
    },
    { status: 200 }
  );
}
