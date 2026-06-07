"use client";

import { classNames } from "@/lib/format";
import s from "./ui.module.css";

const STATE_CLASS: Record<StepState, string> = {
  done: s.isDone,
  active: s.isActive,
  upcoming: s.isUpcoming,
  locked: s.isLocked,
};

export type StepState = "done" | "active" | "upcoming" | "locked";

export interface Step {
  id: string;
  label: string;
  caption?: string;
  state?: StepState;
}

// A calm horizontal journey stepper. Controllable: pass `activeId` to derive
// done/active/upcoming automatically, or set each step's `state` explicitly.
// Clickable steps (done/active) invoke onSelect; locked steps are inert.
export function Stepper({
  steps,
  activeId,
  onSelect,
}: {
  steps: Step[];
  activeId?: string;
  onSelect?: (id: string) => void;
}) {
  const activeIndex = activeId ? steps.findIndex((s) => s.id === activeId) : -1;

  function stateOf(step: Step, i: number): StepState {
    if (step.state) return step.state;
    if (activeIndex < 0) return "upcoming";
    if (i < activeIndex) return "done";
    if (i === activeIndex) return "active";
    return "upcoming";
  }

  return (
    <ol className={s.stepper} role="list">
      {steps.map((step, i) => {
        const state = stateOf(step, i);
        const interactive = !!onSelect && (state === "done" || state === "active");
        return (
          <li key={step.id} className={classNames(s.step, STATE_CLASS[state])}>
            {i > 0 ? <span className={s.stepRail} aria-hidden="true" /> : null}
            <button
              type="button"
              className={s.stepBtn}
              aria-current={state === "active" ? "step" : undefined}
              aria-disabled={!interactive}
              disabled={!interactive}
              onClick={interactive ? () => onSelect?.(step.id) : undefined}
            >
              <span className={s.stepDot} aria-hidden="true">
                {state === "done" ? "✓" : state === "locked" ? "·" : i + 1}
              </span>
              <span className={classNames(s.stepText, "col")}>
                <span className={s.stepLabel}>{step.label}</span>
                {step.caption ? (
                  <span className={classNames(s.stepCaption, "quiet")}>{step.caption}</span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
