"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import s from "./ui.module.css";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

// A right slide-in panel with scrim. Escape closes; focus is trapped inside while
// open and restored to the prior element on close.
export function Drawer({
  open,
  onClose,
  title,
  kicker,
  footer,
  children,
  width = 480,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  kicker?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  width?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = panelRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement
      );
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", onKeyDown);
    const root = panelRef.current;
    const firstFocusable = root?.querySelector<HTMLElement>(FOCUSABLE);
    (firstFocusable ?? root)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus?.();
    };
  }, [open, onKeyDown]);

  if (!open) return null;

  return (
    <div className={s.drawerRoot} role="presentation">
      <div className={s.drawerScrim} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={s.drawerPanel}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        style={{ width }}
      >
        <header className={`${s.drawerHead} spread`}>
          <div className="col" style={{ gap: 4 }}>
            {kicker ? <span className="kicker">{kicker}</span> : null}
            {title ? <h2 style={{ fontSize: 22 }}>{title}</h2> : null}
          </div>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">
            Fermer ✕
          </button>
        </header>
        <div className={s.drawerBody}>{children}</div>
        {footer ? <footer className={s.drawerFoot}>{footer}</footer> : null}
      </div>
    </div>
  );
}
