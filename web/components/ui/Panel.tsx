import type { ReactNode } from "react";
import { classNames } from "@/lib/format";

// A padded LECTURE panel surface with an optional kicker/title header.
export function Panel({
  kicker,
  title,
  aside,
  children,
  className,
  style,
}: {
  kicker?: ReactNode;
  title?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const hasHeader = kicker || title || aside;
  return (
    <section className={classNames("panel", className)} style={style}>
      {hasHeader ? (
        <header className="spread" style={{ marginBottom: 16, alignItems: "flex-start" }}>
          <div className="col" style={{ gap: 4 }}>
            {kicker ? <span className="kicker">{kicker}</span> : null}
            {title ? <h2 style={{ fontSize: 22 }}>{title}</h2> : null}
          </div>
          {aside ? <div className="row">{aside}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
