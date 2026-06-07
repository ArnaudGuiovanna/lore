"use client";

import { useMemo, useState } from "react";
import type { Concept } from "@/lib/types";
import type { Syllabus } from "@/lib/types";
import { Panel } from "@/components/ui/Panel";
import { CodeBlock } from "@/components/runtime/CodeBlock";
import { classNames } from "@/lib/format";
import t from "./trainer.module.css";

// Author a syllabus = intent only (title/description/objectives/outcomes). Objectives are
// concept chips validated against the Go Backend domain DAG. No courses, no resources.
export function AuthorSyllabus({
  concepts,
  initialTitle = "",
  initialDescription = "",
  initialObjectives = [],
  initialOutcomes = [""],
  heading,
  intro,
  submitLabel = "Create syllabus",
  versionNote,
  onCreated,
}: {
  concepts: Concept[];
  initialTitle?: string;
  initialDescription?: string;
  initialObjectives?: string[];
  initialOutcomes?: string[];
  heading: string;
  intro: string;
  submitLabel?: string;
  versionNote?: string;
  onCreated: (s: Syllabus, objectives: string[], outcomes: string[]) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [objectives, setObjectives] = useState<string[]>(initialObjectives);
  const [outcomes, setOutcomes] = useState<string[]>(initialOutcomes.length ? initialOutcomes : [""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conceptById = useMemo(() => new Map(concepts.map((c) => [c.id, c])), [concepts]);
  const available = concepts.filter((c) => !objectives.includes(c.id));

  function addObjective(id: string) {
    if (!objectives.includes(id)) setObjectives((o) => [...o, id]);
  }
  function removeObjective(id: string) {
    setObjectives((o) => o.filter((x) => x !== id));
  }
  function setOutcome(i: number, v: string) {
    setOutcomes((o) => o.map((x, j) => (j === i ? v : x)));
  }

  const cleanOutcomes = outcomes.map((o) => o.trim()).filter(Boolean);
  const valid = title.trim().length > 0 && objectives.length > 0;

  // The exact payload the route handler forwards to POST /v1/tenants/{t}/syllabi.
  const payload = {
    title: title.trim(),
    description: description.trim(),
    objectives: { concepts: objectives },
    outcomes: { statements: cleanOutcomes },
  };

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/syllabi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `HTTP ${res.status}`);
        return;
      }
      onCreated(data as Syllabus, objectives, cleanOutcomes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={t.two}>
      <Panel kicker="Intent only" title={heading}>
        <p className="soft" style={{ marginTop: -6, marginBottom: 20, maxWidth: "62ch" }}>
          {intro}
        </p>

        <div className="col" style={{ gap: 22 }}>
          <label className="col" style={{ gap: 8 }}>
            <span className="kicker">Title *</span>
            <input
              className={t.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Production-grade Go persistence"
            />
          </label>

          <label className="col" style={{ gap: 8 }}>
            <span className="kicker">Description</span>
            <textarea
              className={t.textarea}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What durable competence should this cohort leave with?"
            />
          </label>

          <div className="col" style={{ gap: 8 }}>
            <span className="kicker">Objectives * · validated against the Go Backend DAG</span>
            <div className={t.chipField}>
              {objectives.length === 0 ? (
                <span className="quiet mono" style={{ fontSize: 12 }}>
                  Pick concepts below — these are the runtime's planning targets.
                </span>
              ) : (
                objectives.map((id) => (
                  <span key={id} className={t.objChip}>
                    {conceptById.get(id)?.name ?? id}
                    <button
                      type="button"
                      className={t.objRm}
                      aria-label={`Remove ${id}`}
                      onClick={() => removeObjective(id)}
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>
            <div className={t.dagSuggest}>
              {available.map((c) => (
                <button key={c.id} type="button" className={t.dagSug} onClick={() => addObjective(c.id)}>
                  + {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="col" style={{ gap: 8 }}>
            <span className="kicker">Outcomes · measurable</span>
            {outcomes.map((o, i) => (
              <div key={i} className={t.outcomeRow}>
                <input
                  className={t.input}
                  value={o}
                  onChange={(e) => setOutcome(i, e.target.value)}
                  placeholder="The learner can …"
                />
                {outcomes.length > 1 ? (
                  <button
                    type="button"
                    className={t.outcomeRm}
                    aria-label="Remove outcome"
                    onClick={() => setOutcomes((arr) => arr.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              className="btn ghost"
              style={{ alignSelf: "flex-start" }}
              onClick={() => setOutcomes((o) => [...o, ""])}
            >
              + Add outcome
            </button>
          </div>

          <p className={t.note}>
            No courses. No resources. No manual ordering. You declare <b>intent</b>; the runtime plans the
            parcours and the LLM generates each activity's framing from a TutorInstruction.
          </p>

          {versionNote ? (
            <p className={t.note} style={{ color: "var(--accent)", background: "var(--accent-soft)", borderColor: "rgba(42,79,62,.3)" }}>
              {versionNote}
            </p>
          ) : null}

          {error ? (
            <p className="mono" style={{ color: "var(--alarm)", fontSize: 13, margin: 0 }}>
              {error}
            </p>
          ) : null}

          <div className="row">
            <button
              type="button"
              className={classNames("btn", "primary")}
              disabled={!valid || busy}
              onClick={submit}
            >
              {busy ? "Saving…" : submitLabel}
            </button>
            <span className="quiet mono" style={{ fontSize: 11 }}>
              POST /api/syllabi
            </span>
          </div>
        </div>
      </Panel>

      <div className={t.sticky}>
        <Panel kicker="Request payload" title="What you send">
          <p className="quiet mono" style={{ fontSize: 11, marginTop: -4, marginBottom: 10 }}>
            POST /v1/tenants/{"{t}"}/syllabi
          </p>
          <CodeBlock language="json" code={JSON.stringify(payload, null, 2)} />
        </Panel>
      </div>
    </div>
  );
}
