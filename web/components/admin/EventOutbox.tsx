"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Mark } from "@/components/Mark";
import { fmtDate, titleCase, classNames } from "@/lib/format";
import type { OutboxEvent } from "./types";
import a from "./admin.module.css";

type Filter = "all" | "published" | "unpublished" | "syllabus";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "all" },
  { id: "unpublished", label: "unpublished" },
  { id: "published", label: "published" },
  { id: "syllabus", label: "syllabus events" },
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
        <Mark source="runtime">runtime emitted</Mark>
        <span className="mono quiet" style={{ fontSize: 11 }}>transactional outbox</span>
      </div>
      <p className="soft" style={{ maxWidth: "62ch", margin: 0 }}>
        Configuration writes are persisted, then the runtime emits a domain event to the <em>outbox</em> in
        the same transaction. Subscribers drain it asynchronously. The seed&apos;s real{" "}
        <span className="mono">SyllabusCreated</span> and <span className="mono">SyllabusBound</span> events
        were emitted by the trainer, not the admin.
      </p>

      <Panel
        kicker="Outbox monitor"
        title="The change left a trace"
        aside={
          <span className="row" style={{ gap: 10 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>{pub} published</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--amber)" }}>{unpub} unpublished</span>
          </span>
        }
      >
        {events.length === 0 ? (
          <div className={a.emptyState} role="status">
            <span className={a.ek}>outbox empty</span>
            <span>
              No domain events have been emitted yet. The outbox is a faithful mirror of the runtime&apos;s
              transactional log — when nothing has changed, it stays empty. We don&apos;t fabricate a trace to
              fill it. Apply an LLM-config change and the resulting event will appear here.
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
            <p className="quiet mono" style={{ fontSize: 12 }}>No events match this filter.</p>
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
                    {e.published ? "published" : "unpublished"}
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
          The event is written in the <b>same transaction</b> as the config — it cannot be lost or
          double-emitted. Status moves <b>unpublished → published</b> once a subscriber acknowledges. The
          runtime owns this; your client never publishes events directly. Showing{" "}
          <b>{shown.length}</b> of <b>{events.length}</b> events ({titleCase(filter)}).
        </span>
      </div>
    </div>
  );
}
