import type { ReactNode } from "react";
import { classNames } from "@/lib/format";
import s from "./ui.module.css";

export interface Column<Row> {
  key: string;
  header: ReactNode;
  // Render a cell from the row. Defaults to row[key] when omitted.
  render?: (row: Row) => ReactNode;
  align?: "left" | "right" | "center";
  width?: string | number;
  mono?: boolean;
}

// A scannable, calm table. Generic over row shape; no client interactivity required.
export function DataTable<Row extends Record<string, unknown>>({
  columns,
  rows,
  rowKey,
  empty = "Nothing yet.",
  className,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  empty?: ReactNode;
  className?: string;
}) {
  return (
    <div className={classNames(s.dtWrap, className)}>
      <table className={s.dt}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{ textAlign: c.align ?? "left", width: c.width }}
                className={s.dtTh}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className={classNames(s.dtEmpty, "quiet")} colSpan={columns.length}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={rowKey(row, i)} className={s.dtTr}>
                {columns.map((c) => {
                  const content = c.render ? c.render(row) : (row[c.key] as ReactNode);
                  return (
                    <td
                      key={c.key}
                      className={classNames(s.dtTd, c.mono && s.mono)}
                      style={{ textAlign: c.align ?? "left" }}
                    >
                      {content}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
