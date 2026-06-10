import { api, tpath } from "@/lib/api";
import type { Announcement } from "@/lib/types";

// B-18 — les annonces du périmètre de l'apprenant (ses cohortes + tout
// l'organisme, filtrées par le jeton), en tête de l'accueil. Les 3 plus
// récentes, avec dates. Composant serveur : si la lecture échoue, on n'affiche
// rien — une annonce est un complément, jamais un bloqueur.
function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("fr-FR", { dateStyle: "long" });
}

export async function AnnouncementsStrip() {
  const r = await api.get<Announcement[]>(tpath("/announcements"));
  if (!r.ok || !Array.isArray(r.data)) return null;
  const latest = r.data
    .filter((a) => !a.archived_at)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    .slice(0, 3);
  if (latest.length === 0) return null;

  return (
    <section className="col" style={{ gap: 10 }} aria-label="Annonces" data-testid="learner-announcements">
      <span className="kicker">Annonces</span>
      {latest.map((a) => (
        <div
          key={a.id}
          className="panel col"
          style={{ gap: 6, padding: "12px 16px" }}
          data-testid="learner-announcement"
          data-title={a.title}
        >
          <div className="spread" style={{ flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
            <strong style={{ fontFamily: "var(--serif)", fontSize: 15.5 }}>{a.title}</strong>
            <span className="mono quiet" style={{ fontSize: 10.5 }}>{fmtDate(a.created_at)}</span>
          </div>
          {a.body ? (
            <p className="soft" style={{ fontSize: 13.5, margin: 0, whiteSpace: "pre-wrap" }}>{a.body}</p>
          ) : null}
        </div>
      ))}
    </section>
  );
}
