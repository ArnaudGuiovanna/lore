"use client";

import { useEffect, useRef, useState } from "react";
import s from "@/components/ui/ui.module.css";

// Reveals/streams generated text word-by-word at a humane reading pace.
// Honors prefers-reduced-motion (instant). Used for LLM-generated content so the
// reader experiences it as it would arrive from a stream, never as a wall of text.
export function StreamReader({
  text,
  paced = true,
  wordsPerMinute = 420,
  onDone,
}: {
  text: string;
  paced?: boolean;
  wordsPerMinute?: number;
  onDone?: () => void;
}) {
  const words = text.length ? text.split(/(\s+)/) : [];
  const [count, setCount] = useState(0);
  const doneRef = useRef(false);

  useEffect(() => {
    doneRef.current = false;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!paced || reduced || words.length === 0) {
      setCount(words.length);
      if (!doneRef.current) {
        doneRef.current = true;
        onDone?.();
      }
      return;
    }

    setCount(0);
    // Two array slots per visible word (word + following whitespace).
    const stepMs = Math.max(16, 60000 / wordsPerMinute / 2);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= words.length) {
        window.clearInterval(id);
        if (!doneRef.current) {
          doneRef.current = true;
          onDone?.();
        }
      }
    }, stepMs);
    return () => window.clearInterval(id);
    // Re-stream when the text or pacing changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, paced, wordsPerMinute]);

  const shown = words.slice(0, count).join("");
  const streaming = count < words.length;

  return (
    <span aria-busy={streaming} aria-live="polite">
      {shown}
      {streaming ? <span className={s.srCaret} aria-hidden="true" /> : null}
    </span>
  );
}
