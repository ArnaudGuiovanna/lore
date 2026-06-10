"use client";

// B-17 — ressources pédagogiques (staff) : partager un fichier (lu côté
// client en base64, ≤ 20 Mio) ou un lien, vers une cohorte ou tout
// l'organisme. Liste + archivage. Les apprenants les retrouvent sur
// /learner/resources, dans leur périmètre.
import { useCallback, useEffect, useRef, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ErrorState, LoadingState } from "@/components/ui/States";
import type { Resource } from "@/lib/types";

type Row = Resource & Record<string, unknown>;

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 Mio

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("fr-FR", { dateStyle: "medium" });
}

export function fmtSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Kio`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mio`;
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error || `HTTP ${res.status}`;
}

// Lecture client du fichier en base64 (data URL → on garde la partie encodée).
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("lecture du fichier impossible"));
    reader.onload = () => {
      const url = String(reader.result || "");
      const comma = url.indexOf(",");
      resolve(comma >= 0 ? url.slice(comma + 1) : url);
    };
    reader.readAsDataURL(file);
  });
}

export function ResourcesManager({ cohortId, cohortName }: { cohortId: string; cohortName: string }) {
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [kind, setKind] = useState<"FICHIER" | "LIEN">("FICHIER");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState(""); // "" = tout l'organisme
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/trainer/resources");
      if (!res.ok) throw new Error(await readError(res));
      setResources(((await res.json()) as Resource[]) ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "chargement impossible");
      setResources([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      if (!title.trim()) {
        setError("le titre est requis");
        return;
      }
      if (kind === "LIEN" && !url.trim()) {
        setError("une URL est requise pour un lien");
        return;
      }
      if (kind === "FICHIER") {
        if (!file) {
          setError("choisissez un fichier à partager");
          return;
        }
        if (file.size > MAX_FILE_BYTES) {
          setError("fichier trop volumineux (maximum 20 Mio)");
          return;
        }
      }
      setBusy(true);
      try {
        const payload =
          kind === "FICHIER" && file
            ? {
                kind,
                title,
                description,
                cohort_id: scope,
                file_name: file.name,
                mime_type: file.type || "application/octet-stream",
                content_base64: await fileToBase64(file),
              }
            : { kind, title, description, cohort_id: scope, url };
        const res = await fetch("/api/trainer/resources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await readError(res));
        setTitle("");
        setDescription("");
        setUrl("");
        setFile(null);
        if (fileInput.current) fileInput.current.value = "";
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "partage impossible");
      } finally {
        setBusy(false);
      }
    },
    [kind, title, description, scope, url, file, refresh]
  );

  const archive = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await fetch(`/api/trainer/resources/${encodeURIComponent(id)}`, { method: "DELETE" });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const active = (resources ?? []).filter((r) => !r.archived_at);

  const columns: Column<Row>[] = [
    {
      key: "title",
      header: "Ressource",
      render: (r) => (
        <div className="col" style={{ gap: 2 }}>
          <span data-testid="resource-title-cell">{r.title}</span>
          {r.description ? <span className="quiet" style={{ fontSize: 12 }}>{r.description}</span> : null}
        </div>
      ),
    },
    {
      key: "kind",
      header: "Type",
      render: (r) => <span className="pill">{r.kind === "LIEN" ? "lien" : r.mime_type || "fichier"}</span>,
    },
    {
      key: "size_bytes",
      header: "Taille",
      mono: true,
      align: "right",
      render: (r) => <span>{r.kind === "LIEN" ? "—" : fmtSize(r.size_bytes)}</span>,
    },
    {
      key: "cohort_id",
      header: "Visible par",
      render: (r) =>
        r.cohort_id ? (
          <span className="pill on">{r.cohort_id === cohortId ? cohortName : r.cohort_id.slice(0, 8)}</span>
        ) : (
          <span className="pill">tout l&apos;organisme</span>
        ),
    },
    { key: "created_at", header: "Partagée le", mono: true, render: (r) => <span>{fmtDate(r.created_at)}</span> },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <a
            className="btn ghost"
            style={{ fontSize: 12, textDecoration: "none" }}
            href={`/api/resources/${encodeURIComponent(r.id)}/download`}
            target={r.kind === "LIEN" ? "_blank" : undefined}
            rel={r.kind === "LIEN" ? "noreferrer" : undefined}
            data-testid="resource-download"
          >
            {r.kind === "LIEN" ? "ouvrir ↗" : "↓ télécharger"}
          </a>
          <button
            type="button"
            className="btn ghost"
            style={{ fontSize: 12 }}
            disabled={busy}
            onClick={() => void archive(r.id)}
            data-testid="resource-archive"
          >
            archiver
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="col" style={{ gap: 22 }}>
      <Panel kicker="Ressources" title="Supports partagés">
        {resources === null ? (
          <LoadingState label="Chargement des ressources…" />
        ) : loadError && resources.length === 0 ? (
          <ErrorState
            kicker="Les ressources n'ont pas répondu"
            detail="Les ressources persistées n'ont pas pu être lues — rien n'est inventé pour combler le manque."
            message={loadError}
            action={
              <button type="button" className="btn" onClick={() => void refresh()}>↺ réessayer</button>
            }
          />
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={(active as Row[]) ?? []}
            rowKey={(r) => r.id}
            empty="Aucune ressource partagée — ajoutez la première ci-dessous."
          />
        )}
      </Panel>

      <Panel kicker="Nouvelle ressource" title="Partager un support">
        <form onSubmit={create} className="col" style={{ gap: 12, maxWidth: 620 }} aria-label="Partager une ressource">
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>type</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as "FICHIER" | "LIEN")}
                data-testid="resource-kind"
              >
                <option value="FICHIER">Fichier (≤ 20 Mio)</option>
                <option value="LIEN">Lien externe</option>
              </select>
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>visible par</span>
              <select value={scope} onChange={(e) => setScope(e.target.value)} data-testid="resource-scope">
                <option value="">tout l&apos;organisme</option>
                {cohortId ? <option value={cohortId}>{cohortName}</option> : null}
              </select>
            </label>
          </div>
          <label className="col" style={{ gap: 4 }}>
            <span className="quiet mono" style={{ fontSize: 11 }}>titre</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Aide-mémoire transactions SQL"
              data-testid="resource-title"
            />
          </label>
          <label className="col" style={{ gap: 4 }}>
            <span className="quiet mono" style={{ fontSize: 11 }}>description (optionnel)</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="resource-description"
            />
          </label>
          {kind === "LIEN" ? (
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>url</span>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                data-testid="resource-url"
              />
            </label>
          ) : (
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>fichier</span>
              <input
                ref={fileInput}
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                data-testid="resource-file"
              />
              {file ? (
                <span className="quiet mono" style={{ fontSize: 11 }}>
                  {file.name} · {fmtSize(file.size)}
                </span>
              ) : null}
            </label>
          )}
          {error ? (
            <p className="mono" role="alert" style={{ color: "var(--alarm)", fontSize: 12 }}>{error}</p>
          ) : null}
          <div>
            <button type="submit" className="btn primary" disabled={busy} data-testid="resource-create">
              {busy ? "…" : "Partager la ressource"}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
