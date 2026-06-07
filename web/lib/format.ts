// Small pure formatting/util helpers. Server + client safe (no imports, no side effects).

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// Format a 0..1 ratio as a percentage string, e.g. 0.732 -> "73%".
export function fmtPct(x: number | undefined | null, digits = 0): string {
  if (x === undefined || x === null || Number.isNaN(x)) return "—";
  return `${(clamp(x, 0, 1) * 100).toFixed(digits)}%`;
}

// Deterministic, server-safe date formatting (UTC, no locale drift).
export function fmtDate(iso?: string | null, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toISOString().slice(0, 10);
  return withTime ? `${date} ${d.toISOString().slice(11, 16)} UTC` : date;
}

// "review_due" / "REVIEW DUE" -> "Review Due"
export function titleCase(s: string): string {
  return s
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

// Tiny classnames joiner. Accepts strings and {class: boolean} maps.
export type ClassValue = string | number | false | null | undefined | Record<string, boolean | undefined>;
export function classNames(...parts: ClassValue[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (typeof p === "string" || typeof p === "number") {
      out.push(String(p));
    } else {
      for (const [k, v] of Object.entries(p)) if (v) out.push(k);
    }
  }
  return out.join(" ");
}
