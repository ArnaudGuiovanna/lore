// Calm LECTURE download affordances for the completion attestation PDF.
// Plain anchor links to the server route (GET /api/certificates) — no client JS,
// the browser handles the download via Content-Disposition. Server + client safe.
import Link from "next/link";

// Learner-facing: "Télécharger mon attestation" on the Progress surface.
// Only rendered by the caller when there is real progress (>= 1 tracked concept).
export function LearnerAttestationButton({ learnerId }: { learnerId: string }) {
  return (
    <Link
      href={`/api/certificates?learnerId=${encodeURIComponent(learnerId)}`}
      className="btn"
      prefetch={false}
      // A download hint; the route also sets Content-Disposition: attachment.
      download
      style={{ textDecoration: "none", alignSelf: "flex-start" }}
    >
      Télécharger mon attestation (PDF)
    </Link>
  );
}

// Trainer/admin-facing: a compact per-learner "attestation" link for the roster.
export function RosterAttestationLink({ learnerId }: { learnerId: string }) {
  return (
    <a
      href={`/api/certificates?learnerId=${encodeURIComponent(learnerId)}`}
      className="btn ghost"
      download
      style={{ textDecoration: "none", padding: "3px 10px", fontSize: 12, whiteSpace: "nowrap" }}
    >
      Attestation ↓
    </a>
  );
}
