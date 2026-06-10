import { SurveysBoard } from "@/components/learner/SurveysBoard";

export const dynamic = "force-dynamic";

// B-11 — « Mon avis » : enquêtes de satisfaction ouvertes des cohortes de
// l'apprenant + dépôt de réclamation. Les écritures passent par /api/learner/*.
export default function SurveysScreen() {
  return (
    <div className="col" style={{ gap: 22 }}>
      <div className="col" style={{ gap: 8 }}>
        <span className="kicker">Mon avis</span>
        <h1 className="standfirst" data-testid="learner-surveys-title">
          Votre avis compte — enquêtes et réclamations.
        </h1>
        <p className="soft" style={{ maxWidth: "62ch", fontSize: 14, lineHeight: 1.6 }}>
          Répondez aux enquêtes de satisfaction de vos formations (notes de 1 à 5 et
          commentaires libres) et, si quelque chose ne va pas, déposez une réclamation —
          elle entre au registre officiel de l&apos;organisme.
        </p>
      </div>
      <SurveysBoard />
    </div>
  );
}
