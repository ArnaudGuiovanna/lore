import type { Source } from "@/lib/runtime";
import { sourceLabel } from "@/lib/runtime";
import { Mark } from "@/components/Mark";

// Thin wrapper over Mark for runtime|llm|fallbk provenance, with an optional
// trailing detail (e.g. provider/model) rendered in a quiet mono caption.
export function SourceMark({
  source,
  detail,
  label,
}: {
  source: Source;
  detail?: string;
  label?: string;
}) {
  return (
    <span className="row" style={{ gap: 8, display: "inline-flex", alignItems: "center" }}>
      <Mark source={source}>{label ?? sourceLabel(source)}</Mark>
      {detail ? (
        <span className="mono quiet" style={{ fontSize: 11, letterSpacing: "0.04em" }}>
          {detail}
        </span>
      ) : null}
    </span>
  );
}
