import type { ReactNode } from "react";
import { classNames } from "@/lib/format";

// A LECTURE card surface. `pad` adds interior padding; turn off for edge-to-edge content.
export function Card({
  children,
  className,
  style,
  pad = true,
}: {
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  pad?: boolean;
}) {
  return (
    <div
      className={classNames("card", className)}
      style={{ padding: pad ? 22 : 0, ...style }}
    >
      {children}
    </div>
  );
}
