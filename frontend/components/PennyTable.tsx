import { useId } from "react";
import MoneyText from "@/components/MoneyText";
import { formatTableCell, normalisePennyTable, type PennyTableBlock, type PennyTableColumn } from "@/lib/pennyTable";

/**
 * G251: a table inside Penny's reply, drawn from data.
 *
 * Header row is the DESIGN.md Label (10px, 600, tracked, uppercase, muted).
 * Body cells are the 13px Body step. Figures right-align in tabular figures,
 * and currency uses the `.money` class so it is JetBrains Mono like every
 * other money figure. The block scrolls sideways inside its own container when
 * it is wider than the bubble, with the first column held in place. The title
 * is the table's accessible caption; the summary sentence stays above in the
 * bubble. Every value is React text, never markup. No new colours: slate
 * tokens only, light and dark.
 */
const SURFACE = "bg-white dark:bg-slate-800";

function Cell({ col, value }: { col: PennyTableColumn; value: ReturnType<typeof formatTableCell> }) {
  if (value === null) {
    return <span className="text-slate-400 dark:text-slate-500" role="img" aria-label="No value">-</span>;
  }
  if (col.kind === "money") return <span className="money">{value}</span>;
  if (col.kind === "number" || col.kind === "rate") return <span className="num">{value}</span>;
  if (col.kind === "date") return <span className="num">{value}</span>;
  return <MoneyText text={value} />;
}

export default function PennyTable({ table, now }: { table: PennyTableBlock; now?: Date }) {
  const titleId = useId();
  const block = normalisePennyTable(table);
  if (!block) return null;
  return (
    <figure className="mt-2.5 mb-0 min-w-0" data-penny-table>
      {block.title && (
        <p id={titleId} aria-hidden="true" className="mb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400 break-words">
          {block.title}
        </p>
      )}
      <div
        role="region"
        aria-label={block.title ? undefined : "Table"}
        aria-labelledby={block.title ? titleId : undefined}
        tabIndex={0}
        className={`overflow-x-auto overscroll-x-contain rounded-xl border border-slate-200 dark:border-slate-600 ${SURFACE} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
      >
        <table className="min-w-full border-separate border-spacing-0 text-[13px] text-slate-800 dark:text-slate-100">
          <caption className="sr-only">{block.title || "Table"}</caption>
          <thead>
            <tr>
              {block.columns.map((col, ci) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-600 ${SURFACE} ${col.align === "right" ? "text-right" : "text-left"} ${ci === 0 ? "sticky left-0 z-10" : ""}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, ri) => (
              <tr key={ri}>
                {block.columns.map((col, ci) => {
                  const text = formatTableCell(col, row[col.key], now);
                  const base = `px-3 py-2 align-top ${ri > 0 ? "border-t border-slate-100 dark:border-slate-700" : ""} ${SURFACE}`;
                  const align = col.align === "right" ? "text-right tabular-nums whitespace-nowrap" : "text-left";
                  const first = ci === 0 ? "sticky left-0 z-10 border-r border-r-slate-100 dark:border-r-slate-700" : "";
                  const wrap = col.kind === "text" ? "min-w-[7rem] max-w-[14rem] break-words" : "whitespace-nowrap";
                  return ci === 0 ? (
                    <th key={col.key} scope="row" className={`${base} ${align} ${first} ${wrap} font-normal`}>
                      <Cell col={col} value={text} />
                    </th>
                  ) : (
                    <td key={col.key} className={`${base} ${align} ${wrap}`}>
                      <Cell col={col} value={text} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.note && (
        <figcaption className="mt-1.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400 break-words">{block.note}</figcaption>
      )}
    </figure>
  );
}
