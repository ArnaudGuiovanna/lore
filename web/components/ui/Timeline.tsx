import type { ReactNode } from "react";
import type { Source } from "@/lib/runtime";
import { SourceMark } from "@/components/runtime/SourceMark";
import s from "./ui.module.css";

export interface TimelineItem {
  id: string;
  title?: ReactNode;
  when?: ReactNode;
  // The pedagogical-snapshot slots. Any may be omitted.
  before?: ReactNode;
  observation?: ReactNode;
  after?: ReactNode;
  rationale?: ReactNode;
  // Provenance of the decision shown on this node.
  source?: Source;
  sourceDetail?: string;
}

function Slot({ label, children }: { label: string; children: ReactNode }) {
  if (children === undefined || children === null || children === "") return null;
  return (
    <div className="col" style={{ gap: 2 }}>
      <span className="kicker">{label}</span>
      <div className={s.tlSlotBody}>{children}</div>
    </div>
  );
}

// A vertical snapshot/event timeline. Each node carries before/observation/after/
// rationale slots and a provenance Mark — the runtime's reasoning made legible.
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className={s.tl} role="list">
      {items.map((item) => (
        <li key={item.id} className={s.tlItem}>
          <span className={s.tlNode} aria-hidden="true" />
          <div className={`${s.tlCard} col`} style={{ gap: 12 }}>
            <header className="spread" style={{ alignItems: "flex-start", gap: 12 }}>
              <div className="col" style={{ gap: 2 }}>
                {item.title ? <strong className={s.tlTitle}>{item.title}</strong> : null}
                {item.when ? <span className="quiet mono" style={{ fontSize: 11 }}>{item.when}</span> : null}
              </div>
              {item.source ? <SourceMark source={item.source} detail={item.sourceDetail} /> : null}
            </header>
            <Slot label="Before">{item.before}</Slot>
            <Slot label="Observation">{item.observation}</Slot>
            <Slot label="After">{item.after}</Slot>
            <Slot label="Rationale">{item.rationale}</Slot>
          </div>
        </li>
      ))}
    </ol>
  );
}
