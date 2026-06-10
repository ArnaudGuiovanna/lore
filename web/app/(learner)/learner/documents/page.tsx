import { DocumentsList } from "@/components/learner/DocumentsList";

export const dynamic = "force-dynamic";

// B-10 — « Documents » : les documents contractuels qui concernent CET
// apprenant (le backend filtre par jeton). Lecture seule.
export default function DocumentsScreen() {
  return (
    <div className="col" style={{ gap: 22 }}>
      <div className="col" style={{ gap: 8 }}>
        <span className="kicker">Documents</span>
        <h1 className="standfirst" data-testid="learner-docs-title">
          Vos documents — convention, programme, règlement.
        </h1>
        <p className="soft" style={{ maxWidth: "62ch", fontSize: 14, lineHeight: 1.6 }}>
          Votre organisme publie ici les documents contractuels qui vous concernent.
          Chaque document est versionné : vous lisez toujours la dernière version en vigueur.
        </p>
      </div>
      <DocumentsList />
    </div>
  );
}
