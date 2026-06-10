"use client";

// B-10 — documents contractuels de l'OF : création avec gabarit pré-rempli par
// kind, liste (dernière version par chaîne), visualisation du body, nouvelle
// version, archivage. Versionnage append-only côté backend (root_id).
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorState, LoadingState } from "@/components/ui/States";
import type { OFDocument, OFDocumentKind } from "@/lib/types";
import type { NamedRef } from "./Conformite";

type Row = OFDocument & Record<string, unknown>;

const KIND_LABELS: Record<OFDocumentKind, string> = {
  CONVENTION: "Convention de formation",
  CONTRAT: "Contrat de formation",
  DEVIS: "Devis",
  PROGRAMME: "Programme de formation",
  REGLEMENT_INTERIEUR: "Règlement intérieur",
  AUTRE: "Autre document",
};

// Gabarits pré-remplis (articles minimaux attendus par le RNQ) — modifiables
// librement avant création ; les champs {{…}} sont à compléter.
const TEMPLATES: Record<OFDocumentKind, { title: string; body: string }> = {
  CONVENTION: {
    title: "Convention de formation professionnelle",
    body:
      "CONVENTION DE FORMATION PROFESSIONNELLE\n(articles L.6353-1 et suivants du Code du travail)\n\n" +
      "Entre l'organisme de formation : {{raison_sociale}}, SIRET {{siret}}, NDA {{nda}},\n" +
      "représenté par {{representant}},\net le bénéficiaire : {{beneficiaire}}.\n\n" +
      "Article 1 — Objet : {{intitule_action}}.\nArticle 2 — Durée et période : {{duree}} heures, du {{debut}} au {{fin}}.\n" +
      "Article 3 — Modalités : formation ouverte et à distance (FOAD) avec assistance pédagogique.\n" +
      "Article 4 — Prix : {{prix}} € net de taxe.\nArticle 5 — Modalités de règlement et financement : {{financement}}.\n" +
      "Article 6 — Dédit et abandon : conditions prévues à l'article L.6354-1.\n",
  },
  CONTRAT: {
    title: "Contrat de formation professionnelle",
    body:
      "CONTRAT DE FORMATION PROFESSIONNELLE\n(article L.6353-3 du Code du travail — personne physique à ses frais)\n\n" +
      "Organisme : {{raison_sociale}} — Stagiaire : {{stagiaire}}.\n\n" +
      "1. Objet et programme : {{intitule_action}}.\n2. Durée : {{duree}} heures.\n" +
      "3. Prix et échéancier : {{prix}} €.\n4. Délai de rétractation : 10 jours (article L.6353-5).\n" +
      "5. Interruption : modalités de l'article L.6353-7.\n",
  },
  DEVIS: {
    title: "Devis de formation",
    body:
      "DEVIS\n\nOrganisme : {{raison_sociale}} — SIRET {{siret}}.\nDestinataire : {{destinataire}}.\n\n" +
      "Action : {{intitule_action}}.\nDurée : {{duree}} heures.\nPériode : {{periode}}.\n" +
      "Prix : {{prix}} € net de taxe (exonération TVA art. 261-4-4° a du CGI).\nValidité du devis : 3 mois.\n",
  },
  PROGRAMME: {
    title: "Programme de formation",
    body:
      "PROGRAMME DE FORMATION\n\nIntitulé : {{intitule_action}}.\nPublic visé et prérequis : {{public_prerequis}}.\n" +
      "Objectifs pédagogiques : {{objectifs}}.\nContenu (séquences) : {{contenu}}.\n" +
      "Modalités pédagogiques : parcours adaptatif assisté (FOAD), tutorat asynchrone.\n" +
      "Modalités d'évaluation : positionnement initial, évaluations corrigées, suivi de maîtrise.\n" +
      "Durée : {{duree}} heures. Accessibilité handicap : {{referent_handicap}}.\n",
  },
  REGLEMENT_INTERIEUR: {
    title: "Règlement intérieur",
    body:
      "RÈGLEMENT INTÉRIEUR\n(articles L.6352-3 et suivants du Code du travail)\n\n" +
      "Article 1 — Champ d'application : le présent règlement s'applique à tous les stagiaires de {{raison_sociale}}.\n" +
      "Article 2 — Hygiène et sécurité : prescriptions applicables au lieu de formation et à la FOAD.\n" +
      "Article 3 — Discipline et sanctions : échelle des sanctions et garanties procédurales.\n" +
      "Article 4 — Représentation des stagiaires : conditions de l'élection des délégués.\n",
  },
  AUTRE: {
    title: "",
    body: "",
  },
};

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("fr-FR", { dateStyle: "medium" });
}

export function DocumentsOF({ cohorts, learners }: { cohorts: NamedRef[]; learners: NamedRef[] }) {
  const [documents, setDocuments] = useState<OFDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<OFDocument | null>(null);
  // Nouvelle version : pré-rempli avec la version courante.
  const [revising, setRevising] = useState<OFDocument | null>(null);
  const [revision, setRevision] = useState({ title: "", body: "" });

  const [form, setForm] = useState({
    kind: "CONVENTION" as OFDocumentKind,
    title: TEMPLATES.CONVENTION.title,
    body: TEMPLATES.CONVENTION.body,
    cohortId: "",
    learnerId: "",
  });

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/conformite/documents");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setDocuments(((await res.json()) as OFDocument[]) ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "chargement impossible");
      setDocuments([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pickKind = useCallback((kind: OFDocumentKind) => {
    const t = TEMPLATES[kind];
    setForm((f) => ({ ...f, kind, title: t.title, body: t.body }));
  }, []);

  const create = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!form.title.trim()) {
        setError("le titre est requis");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/conformite/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: form.kind,
            title: form.title.trim(),
            body: form.body,
            cohort_id: form.cohortId || undefined,
            learner_id: form.learnerId || undefined,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        pickKind(form.kind); // re-seed the template for the next document
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "création impossible");
      } finally {
        setBusy(false);
      }
    },
    [form, refresh, pickKind]
  );

  const archive = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await fetch(`/api/admin/conformite/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const submitRevision = useCallback(async () => {
    if (!revising) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/conformite/documents/${encodeURIComponent(revising.id)}/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: revision.title, body: revision.body }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setRevising(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "nouvelle version impossible");
    } finally {
      setBusy(false);
    }
  }, [revising, revision, refresh]);

  const scopeOf = (d: OFDocument): string => {
    if (d.learner_id) return learners.find((l) => l.id === d.learner_id)?.name ?? "apprenant";
    if (d.cohort_id) return cohorts.find((c) => c.id === d.cohort_id)?.name ?? "cohorte";
    return "tout le tenant";
  };

  const columns: Column<Row>[] = [
    {
      key: "title",
      header: "Document",
      render: (r) => (
        <span className="col" style={{ gap: 2 }}>
          <span style={{ fontFamily: "var(--serif)", fontSize: 15 }}>{r.title}</span>
          <span className="mono quiet" style={{ fontSize: 10.5 }}>{KIND_LABELS[r.kind] ?? r.kind}</span>
        </span>
      ),
    },
    { key: "version", header: "Version", align: "right", mono: true, render: (r) => <span>v{r.version}</span> },
    { key: "scope", header: "Portée", render: (r) => <span>{scopeOf(r)}</span> },
    { key: "created_at", header: "Créé le", mono: true, render: (r) => <span>{fmtDate(r.created_at)}</span> },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <span className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn ghost"
            style={{ fontSize: 12 }}
            onClick={() => setViewing(r)}
            data-testid="doc-view"
          >
            voir
          </button>
          <button
            type="button"
            className="btn ghost"
            style={{ fontSize: 12 }}
            onClick={() => {
              setRevising(r);
              setRevision({ title: r.title, body: r.body ?? "" });
            }}
          >
            nouvelle version
          </button>
          <button
            type="button"
            className="btn ghost"
            style={{ fontSize: 12, color: "var(--alarm)" }}
            disabled={busy}
            onClick={() => void archive(r.id)}
          >
            archiver
          </button>
        </span>
      ),
    },
  ];

  return (
    <div className="col" style={{ gap: 22 }}>
      <Panel
        kicker="Documents contractuels"
        title="Conventions, contrats, devis, programmes, règlement"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>versions append-only</span>}
      >
        {documents === null ? (
          <LoadingState label="Chargement des documents…" />
        ) : loadError && documents.length === 0 ? (
          <ErrorState
            kicker="Les documents n'ont pas répondu"
            detail="La liste des documents n'a pas pu être lue — rien n'est inventé pour combler le manque."
            message={loadError}
            action={
              <button type="button" className="btn" onClick={() => void refresh()}>
                ↺ réessayer
              </button>
            }
          />
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={(documents as Row[]) ?? []}
            rowKey={(r) => r.id}
            empty="Aucun document — créez le premier ci-dessous (un gabarit est pré-rempli par type)."
          />
        )}
      </Panel>

      <Panel kicker="Nouveau document" title="Créer à partir d'un gabarit">
        <form onSubmit={create} className="col" style={{ gap: 12, maxWidth: 720 }} data-testid="doc-create-form">
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>type</span>
              <select
                value={form.kind}
                onChange={(e) => pickKind(e.target.value as OFDocumentKind)}
                data-testid="doc-kind"
              >
                {(Object.keys(KIND_LABELS) as OFDocumentKind[]).map((k) => (
                  <option key={k} value={k}>{KIND_LABELS[k]}</option>
                ))}
              </select>
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>cohorte (optionnel)</span>
              <select
                value={form.cohortId}
                onChange={(e) => setForm((f) => ({ ...f, cohortId: e.target.value, learnerId: "" }))}
                data-testid="doc-cohort"
              >
                <option value="">— tout le tenant —</option>
                {cohorts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>apprenant (optionnel)</span>
              <select
                value={form.learnerId}
                onChange={(e) => setForm((f) => ({ ...f, learnerId: e.target.value, cohortId: "" }))}
              >
                <option value="">— non nominatif —</option>
                {learners.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="col" style={{ gap: 4 }}>
            <span className="quiet mono" style={{ fontSize: 11 }}>titre</span>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Titre du document"
              data-testid="doc-title"
            />
          </label>
          <label className="col" style={{ gap: 4 }}>
            <span className="quiet mono" style={{ fontSize: 11 }}>contenu (gabarit modifiable — complétez les champs {"{{…}}"})</span>
            <textarea
              rows={10}
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              data-testid="doc-body"
              style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}
            />
          </label>
          {error ? (
            <p className="mono" style={{ color: "var(--alarm)", fontSize: 12, margin: 0 }}>{error}</p>
          ) : null}
          <div>
            <button type="submit" className="btn primary" disabled={busy} data-testid="doc-create-submit">
              {busy ? "…" : "Créer le document (v1)"}
            </button>
          </div>
        </form>
      </Panel>

      <Drawer
        open={!!viewing}
        onClose={() => setViewing(null)}
        kicker={viewing ? `${KIND_LABELS[viewing.kind] ?? viewing.kind} · v${viewing.version}` : ""}
        title={viewing?.title ?? ""}
        width={560}
      >
        {viewing ? (
          <pre
            className="mono"
            data-testid="doc-body-view"
            style={{
              fontSize: 12.5,
              whiteSpace: "pre-wrap",
              background: "var(--paper)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: "12px 14px",
              margin: 0,
            }}
          >
            {viewing.body || "(document sans contenu)"}
          </pre>
        ) : null}
      </Drawer>

      <Drawer
        open={!!revising}
        onClose={() => setRevising(null)}
        kicker={revising ? `nouvelle version · actuellement v${revising.version}` : ""}
        title={revising ? `Réviser · ${revising.title}` : ""}
        width={560}
        footer={
          <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
            <button type="button" className="btn ghost" onClick={() => setRevising(null)}>
              Annuler
            </button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void submitRevision()}>
              {busy ? "…" : `Publier la v${(revising?.version ?? 0) + 1}`}
            </button>
          </div>
        }
      >
        {revising ? (
          <div className="col" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>titre</span>
              <input
                value={revision.title}
                onChange={(e) => setRevision((v) => ({ ...v, title: e.target.value }))}
              />
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>contenu</span>
              <textarea
                rows={14}
                value={revision.body}
                onChange={(e) => setRevision((v) => ({ ...v, body: e.target.value }))}
                style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}
              />
            </label>
            {error ? (
              <p className="mono" style={{ color: "var(--alarm)", fontSize: 12, margin: 0 }}>{error}</p>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
