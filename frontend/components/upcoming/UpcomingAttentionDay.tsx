"use client";

import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import UpcomingDayCard from "./UpcomingDayCard";
import UpcomingRow, { type UpcomingRowModel } from "./UpcomingRow";
import { getUpcomingStatus, upcomingMoney } from "@/lib/upcomingAttention";

type Props = {
  dayKeyIso: string;
  heading: string;
  rows: UpcomingRowModel[];
  onOpen: (model: UpcomingRowModel) => void;
  onDismiss: (model: UpcomingRowModel) => void;
};

function FoldedRows({ rows, label, renderRow }: {
  rows: UpcomingRowModel[];
  label: string;
  renderRow: (model: UpcomingRowModel) => React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const highlightedKey = rows.find((row) => row.highlighted)?.rowKey;
  useEffect(() => {
    // Reveal a Home/Review deep link before the parent scrolls to its row.
    // Do not close again when the transient highlight expires.
    if (highlightedKey && ref.current) ref.current.open = true;
  }, [highlightedKey]);
  const totalPence = rows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0);

  return <details ref={ref} className="group" data-upcoming-fold={label}>
    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:bg-slate-700 [&::-webkit-details-marker]:hidden">
      <span className="min-w-0 flex-1">{rows.length} {label} · <span className="font-mono tabular-nums">{upcomingMoney(totalPence / 100)}</span></span>
      <span className="text-xs font-medium text-slate-600 dark:text-slate-400"><span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span></span>
      <ChevronDown size={15} className="shrink-0 transition-transform motion-reduce:transition-none group-open:rotate-180" aria-hidden="true" />
    </summary>
    <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-700 dark:border-slate-700">{rows.map(renderRow)}</div>
  </details>;
}

// Approved G176 C boundary. The real page and preview use the same grouping,
// disclosures, row treatment and highlight behaviour, with different data.
export default function UpcomingAttentionDay({ dayKeyIso, heading, rows, onOpen, onDismiss }: Props) {
  const groups = {
    open: [] as UpcomingRowModel[], covered: [] as UpcomingRowModel[],
    future: [] as UpcomingRowModel[], card: [] as UpcomingRowModel[], settling: [] as UpcomingRowModel[],
  };
  for (const row of rows) {
    const status = getUpcomingStatus(row);
    if (status.kind === "issue" || status.kind === "income") groups.open.push(row);
    else groups[status.kind].push(row);
  }
  const renderRow = (model: UpcomingRowModel) => <UpcomingRow key={model.identity ?? model.rowKey} model={model} treatment="needs-attention" onOpen={() => onOpen(model)} onDismiss={() => onDismiss(model)} />;
  const activeRows = groups.open.map(renderRow);
  if (groups.covered.length) {
    const movesOnly = groups.covered.every((row) => row.isMovement);
    const noun = movesOnly ? "move" : "payment";
    activeRows.push(<FoldedRows key="covered" rows={groups.covered} label={`covered ${noun}${groups.covered.length === 1 ? "" : "s"}`} renderRow={renderRow} />);
  }
  if (groups.card.length) activeRows.push(<FoldedRows key="card" rows={groups.card} label={`card ${groups.card.length === 1 ? "charge" : "charges"}`} renderRow={renderRow} />);
  if (groups.future.length) activeRows.push(<FoldedRows key="future" rows={groups.future} label={`later ${groups.future.length === 1 ? "payment" : "payments"}`} renderRow={renderRow} />);

  return <UpcomingDayCard dayKeyIso={dayKeyIso} heading={heading} activeRows={activeRows} settlingRows={groups.settling.map(renderRow)} />;
}
