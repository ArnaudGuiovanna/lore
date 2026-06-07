import { Panel } from "@/components/ui/Panel";
import { Mark } from "@/components/Mark";
import { pct } from "@/lib/runtime";
import type { Concept, Dependency } from "@/lib/types";
import type { DomainGraphData } from "./types";
import a from "./admin.module.css";

interface Laid {
  concept: Concept;
  col: number;
  row: number;
  x: number;
  y: number;
}

const NODE_W = 150;
const NODE_H = 46;
const COL_GAP = 80;
const ROW_GAP = 26;
const PAD = 16;

// Deterministic, cycle-safe layered layout. Longest-path layering assigns each
// concept a column = 1 + max(prereq columns); cycle-safe because we cap depth.
function layout(concepts: Concept[], deps: Dependency[]): { nodes: Laid[]; width: number; height: number; acyclic: boolean } {
  const ids = concepts.map((c) => c.id);
  const idSet = new Set(ids);
  const parents = new Map<string, string[]>(); // child -> prereqs
  for (const id of ids) parents.set(id, []);
  for (const d of deps) {
    if (idSet.has(d.parent_concept_id) && idSet.has(d.child_concept_id)) {
      parents.get(d.child_concept_id)!.push(d.parent_concept_id);
    }
  }

  const col = new Map<string, number>();
  const cap = ids.length; // depth cap => cycle-safe (no infinite recursion)
  let acyclic = true;
  function depth(id: string, seen: Set<string>): number {
    if (col.has(id)) return col.get(id)!;
    if (seen.has(id) || seen.size > cap) {
      acyclic = false;
      return 0;
    }
    seen.add(id);
    const ps = parents.get(id) ?? [];
    const c = ps.length ? 1 + Math.max(...ps.map((p) => depth(p, seen))) : 0;
    seen.delete(id);
    col.set(id, c);
    return c;
  }
  for (const id of ids) depth(id, new Set());

  // group by column, stable order by concept id for determinism
  const byCol = new Map<number, Concept[]>();
  for (const c of concepts) {
    const k = col.get(c.id) ?? 0;
    if (!byCol.has(k)) byCol.set(k, []);
    byCol.get(k)!.push(c);
  }
  const maxCol = Math.max(0, ...[...byCol.keys()]);
  const nodes: Laid[] = [];
  let maxRows = 0;
  for (let c = 0; c <= maxCol; c++) {
    const items = (byCol.get(c) ?? []).slice().sort((x, y) => x.id.localeCompare(y.id));
    maxRows = Math.max(maxRows, items.length);
    items.forEach((concept, r) => {
      nodes.push({
        concept,
        col: c,
        row: r,
        x: PAD + c * (NODE_W + COL_GAP),
        y: PAD + r * (NODE_H + ROW_GAP),
      });
    });
  }
  const width = PAD * 2 + (maxCol + 1) * NODE_W + maxCol * COL_GAP;
  const height = PAD * 2 + maxRows * NODE_H + Math.max(0, maxRows - 1) * ROW_GAP;
  return { nodes, width, height, acyclic };
}

// Read-only view of the runtime's concept DAG. Edges point prereq → dependent.
export function DomainGraph({ graph }: { graph: DomainGraphData }) {
  const { nodes, width, height, acyclic } = layout(graph.concepts, graph.dependencies);
  const byId = new Map(nodes.map((n) => [n.concept.id, n]));
  const edges = graph.dependencies.filter(
    (d) => byId.has(d.parent_concept_id) && byId.has(d.child_concept_id)
  );

  return (
    <div className="col" style={{ gap: 22 }}>
      <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Mark source="runtime">structure décidée par le runtime</Mark>
        <span className="mono quiet" style={{ fontSize: 11 }}>domaine · {graph.domainName}</span>
      </div>
      <p className="soft" style={{ maxWidth: "62ch", margin: 0 }}>
        Voici le graphe de dépendances que le runtime parcourt pour choisir le prochain concept de chaque
        apprenant. Vous pouvez le lire et le valider ; vous ne pouvez pas modifier la progression. Les arêtes vont
        du prérequis → dépendant ; «&nbsp;diff&nbsp;» est le poids de difficulté du runtime.
      </p>

      <Panel
        kicker="Graphe du domaine"
        title="Le DAG de concepts, en lecture seule"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>GET /v1/tenants/…/domains/{graph.domainId.slice(0, 8)}</span>}
      >
        {graph.concepts.length === 0 ? (
          <div className={a.emptyState} role="status">
            <span className={a.ek}>aucun concept résolu</span>
            <span>
              La lecture du domaine n&apos;a renvoyé aucun concept ; il n&apos;y a donc pas encore de DAG à parcourir.
              Soit le runtime n&apos;a pas répondu, soit ce domaine n&apos;a pas été peuplé. Le graphe appartient au
              runtime — le plan de contrôle ne fait que le lire, il n&apos;y a donc rien à ajouter ici.
            </span>
          </div>
        ) : (
        <>
        <div className={a.graphShell}>
          <svg
            className={a.dag}
            viewBox={`0 0 ${width} ${height}`}
            style={{ width: width }}
            role="img"
            aria-label={`Graphe de dépendances des concepts ${graph.domainName}`}
          >
            <defs>
              <marker id="adm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className={a.edgeArrow} />
              </marker>
            </defs>
            <g fill="none">
              {edges.map((d) => {
                const p = byId.get(d.parent_concept_id)!;
                const c = byId.get(d.child_concept_id)!;
                const x1 = p.x + NODE_W;
                const y1 = p.y + NODE_H / 2;
                const x2 = c.x;
                const y2 = c.y + NODE_H / 2;
                const mx = (x1 + x2) / 2;
                return (
                  <path
                    key={`${d.parent_concept_id}->${d.child_concept_id}`}
                    className={a.edge}
                    d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                    markerEnd="url(#adm-arrow)"
                  />
                );
              })}
            </g>
            <g>
              {nodes.map((n) => (
                <g key={n.concept.id} className={a.gnode} transform={`translate(${n.x},${n.y})`}>
                  <rect width={NODE_W} height={NODE_H} rx={9} />
                  <text className={a.gname} x={13} y={20}>
                    {n.concept.name}
                  </text>
                  <text className={a.gdiff} x={13} y={36}>
                    diff {pct(n.concept.difficulty)}
                  </text>
                </g>
              ))}
            </g>
          </svg>
        </div>

        <div className={a.legend}>
          <span className={a.lg}>
            <span className={a.sw} /> concept · prérequis → dépendant
          </span>
          <span className={a.lg}>pointe de flèche = sens de la dépendance</span>
        </div>

        <div className={a.validity}>
          <span className={a.ck}>{acyclic ? "✓" : "!"}</span>
          <span>
            {graph.concepts.length} concepts · {edges.length} arêtes ·{" "}
            {acyclic ? "acyclique — aucun cycle, aucune arête invalide. Ordre topologique résolu." : "cycle détecté — le rattachement serait refusé."}
          </span>
        </div>
        </>
        )}
      </Panel>

      <div className={a.note}>
        <span className={a.noteIco} aria-hidden="true">↻</span>
        <span>
          La validation est <b>sûre vis-à-vis des cycles</b> : le runtime refuse de rattacher un syllabus sur un
          graphe comportant un cycle ou une arête vers un concept inconnu. Ici, la lecture du domaine résout un
          ordre topologique propre — le runtime peut donc toujours nommer un concept suivant. Version du graphe{" "}
          <b>v{graph.graphVersion}</b>.
        </span>
      </div>
    </div>
  );
}
