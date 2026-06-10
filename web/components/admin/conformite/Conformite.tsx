"use client";

// Vague D « Conformité OF » — un seul volet d'admin avec une sous-navigation
// interne (7 onglets) plutôt que 7 sections top-level : le RNQ se pilote d'un
// seul endroit. Chaque onglet est un composant autonome qui parle aux proxys
// /api/admin/conformite/* (session + rôle vérifiés côté serveur).
import { useState } from "react";
import { classNames } from "@/lib/format";
import { ProfilOF } from "./ProfilOF";
import { DocumentsOF } from "./DocumentsOF";
import { Satisfaction } from "./Satisfaction";
import { Reclamations } from "./Reclamations";
import { Financements } from "./Financements";
import { RgpdErase } from "./RgpdErase";
import { TextesLegaux } from "./TextesLegaux";
import a from "../admin.module.css";

export interface NamedRef {
  id: string;
  name: string;
}

type Tab =
  | "profil"
  | "documents"
  | "satisfaction"
  | "reclamations"
  | "financements"
  | "rgpd"
  | "legal";

const TABS: { id: Tab; label: string }[] = [
  { id: "profil", label: "Profil OF" },
  { id: "documents", label: "Documents" },
  { id: "satisfaction", label: "Satisfaction" },
  { id: "reclamations", label: "Réclamations" },
  { id: "financements", label: "Financements" },
  { id: "rgpd", label: "RGPD" },
  { id: "legal", label: "Textes légaux" },
];

export function Conformite({
  cohorts,
  learners,
  people,
  canErase = true,
}: {
  cohorts: NamedRef[];
  learners: NamedRef[];
  // user id → nom (memberships) pour le registre des consentements.
  people: NamedRef[];
  // B-27 : l'effacement RGPD reste un acte d'administrateur — le GESTIONNAIRE
  // ne voit pas l'onglet (le backend lui refuse la capacité erase_data).
  canErase?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("profil");
  const tabs = canErase ? TABS : TABS.filter((t) => t.id !== "rgpd");

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="col" style={{ gap: 6 }}>
        <h2 style={{ fontSize: 24 }}>Conformité de l&apos;organisme de formation</h2>
        <p className="soft" style={{ maxWidth: "64ch", margin: 0, fontSize: 14, lineHeight: 1.6 }}>
          Profil légal, documents contractuels, satisfaction, réclamations, financements,
          RGPD et textes légaux — les preuves que l&apos;audit Qualiopi et le BPF attendent,
          au même endroit.
        </p>
      </div>

      <nav aria-label="Onglets de conformité" className={a.nav} style={{ flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={classNames(a.navBtn, tab === t.id && a.navOn)}
            aria-current={tab === t.id ? "true" : undefined}
            onClick={() => setTab(t.id)}
            data-testid={`conformite-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "profil" ? <ProfilOF cohorts={cohorts} /> : null}
      {tab === "documents" ? <DocumentsOF cohorts={cohorts} learners={learners} /> : null}
      {tab === "satisfaction" ? <Satisfaction cohorts={cohorts} learners={learners} /> : null}
      {tab === "reclamations" ? <Reclamations people={people} /> : null}
      {tab === "financements" ? <Financements cohorts={cohorts} learners={learners} /> : null}
      {tab === "rgpd" && canErase ? <RgpdErase learners={learners} /> : null}
      {tab === "legal" ? <TextesLegaux people={people} /> : null}
    </div>
  );
}
