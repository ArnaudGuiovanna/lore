"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Mark } from "@/components/Mark";
import { fmtDate, classNames } from "@/lib/format";
import type { OutboxEvent } from "./types";
import a from "./admin.module.css";

type Filter = "all" | "published" | "unpublished" | "syllabus";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "tous" },
  { id: "unpublished", label: "non publiés" },
  { id: "published", label: "publiés" },
  { id: "syllabus", label: "événements syllabus" },
];

// The event outbox: real persisted domain events (incl. the seed's SyllabusCreated
// and SyllabusBound). Status is unpublished until a subscriber acknowledges.
export function EventOutbox({ events }: { events: OutboxEvent[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const shown = useMemo(() => {
    switch (filter) {
      case "published":
        return events.filter((e) => e.published);
      case "unpublished":
        return events.filter((e) => !e.published);
      case "syllabus":
        return events.filter((e) => e.eventType.startsWith("Syllabus"));
      default:
        return events;
    }
  }, [events, filter]);

  const pub = events.filter((e) => e.published).length;
  const unpub = events.length - pub;

  return (
    <div className="col" style={{ gap: 22 }}>
      <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Mark source="runtime">émis par le runtime</Mark>
        <span className="mono quiet" style={{ fontSize: 11 }}>outbox transactionnelle</span>
      </div>
      <p className="soft" style={{ maxWidth: "62ch", margin: 0 }}>
        Les écritures de configuration sont persistées, puis le runtime émet un événement de domaine dans
        l&apos;<em>outbox</em> au sein de la même transaction. Les abonnés la vident de façon asynchrone. Les vrais
        événements <span className="mono">SyllabusCreated</span> et <span className="mono">SyllabusBound</span> des
        données initiales ont été émis par le formateur, pas par l&apos;admin.
      </p>

      <Panel
        kicker="Moniteur d'outbox"
        title="Le changement a laissé une trace"
        aside={
          <span className="row" style={{ gap: 10 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>{pub} publiés</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--amber)" }}>{unpub} non publiés</span>
          </span>
        }
      >
        {events.length === 0 ? (
          <div className={a.emptyState} role="status">
            <span className={a.ek}>outbox vide</span>
            <span>
              Aucun événement de domaine n&apos;a encore été émis. L&apos;outbox est un miroir fidèle du journal
              transactionnel du runtime — quand rien n&apos;a changé, elle reste vide. Nous n&apos;inventons pas de
              trace pour la remplir. Appliquez un changement de config LLM et l&apos;événement résultant apparaîtra
              ici.
            </span>
          </div>
        ) : (
        <>
        <div className={a.filterRow}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={classNames(a.filterBtn, filter === f.id && a.filterOn)}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className={a.outbox}>
          {shown.length === 0 ? (
            <p className="quiet mono" style={{ fontSize: 12 }}>Aucun événement ne correspond à ce filtre.</p>
          ) : (
            shown.map((e) => {
              const isSyl = e.eventType.startsWith("Syllabus");
              const fresh = e.id.startsWith("local-");
              return (
                <div key={e.id} className={classNames(a.evt, fresh && a.evtFresh)}>
                  <span className={a.evico} aria-hidden="true">{isSyl ? "≣" : "◇"}</span>
                  <div>
                    <div className={a.evname}>{e.eventType}</div>
                    <div className={a.evmeta}>
                      {e.aggregateType ? `${e.aggregateType} · ` : ""}
                      {e.aggregateId ? `${e.aggregateId.slice(0, 8)} · ` : ""}
                      {fmtDate(e.occurredAt, true)}
                      {e.annotation ? ` · ${e.annotation}` : ""}
                    </div>
                  </div>
                  <span className={classNames(a.evstatus, e.published ? a.pub : a.unpub)}>
                    <span className={a.sd} />
                    {e.published ? "publié" : "non publié"}
                  </span>
                </div>
              );
            })
          )}
        </div>
        </>
        )}
      </Panel>

      <div className={a.note}>
        <span className={a.noteIco} aria-hidden="true">◇</span>
        <span>
          L&apos;événement est écrit dans la <b>même transaction</b> que la config — il ne peut être ni perdu ni
          émis deux fois. Le statut passe de <b>non publié → publié</b> dès qu&apos;un abonné accuse réception. Le
          runtime en est propriétaire ; votre client ne publie jamais d&apos;événements directement. Affichage de{" "}
          <b>{shown.length}</b> sur <b>{events.length}</b> événements ({FILTERS.find((f) => f.id === filter)?.label ?? filter}).
        </span>
      </div>
    </div>
  );
}
