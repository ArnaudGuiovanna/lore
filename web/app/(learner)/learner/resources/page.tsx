import { ResourcesList } from "@/components/learner/ResourcesList";

export const dynamic = "force-dynamic";

// B-17 — « Ressources » : les supports (fichiers, liens) que le formateur a
// partagés avec votre groupe ou tout l'organisme. Lecture seule.
export default function ResourcesScreen() {
  return (
    <div className="col" style={{ gap: 22 }}>
      <div className="col" style={{ gap: 8 }}>
        <span className="kicker">Ressources</span>
        <h1 className="standfirst" data-testid="learner-resources-title">
          Les supports partagés par votre formateur.
        </h1>
        <p className="soft" style={{ maxWidth: "62ch", fontSize: 14, lineHeight: 1.6 }}>
          Fichiers et liens publiés pour votre groupe ou pour tout l&apos;organisme. Ce sont des
          compléments — votre parcours, lui, reste planifié par le runtime.
        </p>
      </div>
      <ResourcesList />
    </div>
  );
}
