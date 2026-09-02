"use client";

// TEMPORARY PREVIEW — Variant C, "undo log".
//
// A genuinely different direction from A and B: instead of organising by
// provenance, this treats the page as a timeline of set-aside events, each
// one reversible in a single tap via a large circular undo control (the
// primary affordance on every row, not a pill tucked at the bottom). The
// spine down the left is the one piece of "timeline" chrome; everything
// else stays as plain rows so the page still reads as a quiet maintenance
// list, not a destination.
//
// Honesty note: user rows don't have a real "set aside" timestamp
// (dismissed_recurring stores only the key), so their spine label reads
// "Last seen" against the transaction-derived date, never "Set aside" —
// only engine rows, which do store vetoedAt, get that label. Conflating
// the two would imply the app tracks something it doesn't.

import { useState } from "react";
import { Undo2 } from "lucide-react";
import { bankBadgeProps } from "./bankBadge";
import { BankBadge } from "@/components/AccountMiniCard";
import { formatMoney, formatRelative, formatDate, verdictLine, type DismissedRow } from "./fixtures";
import EntryPointMocks from "./EntryPointMocks";

function spineLabel(row: DismissedRow): string {
  return row.provenance === "engine"
    ? `Set aside ${formatRelative(row.vetoedAt as string)}`
    : `Last seen ${formatDate(row.lastSeen)}`;
}

export default function VariantC({ rows }: { rows: DismissedRow[] }) {
  const [live, setLive] = useState(rows);
  const [toast, setToast] = useState<{ name: string; row: DismissedRow } | null>(null);

  function restore(row: DismissedRow) {
    setLive((prev) => prev.filter((r) => r.key !== row.key));
    setToast({ name: row.displayName, row });
    window.setTimeout(() => setToast(null), 5000);
  }
  function undo() {
    if (!toast) return;
    setLive((prev) => [toast.row, ...prev]);
    setToast(null);
  }

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-16">
      <div className="mx-auto w-full max-w-[430px] px-4 pt-6">
        <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">Set aside</h1>
        <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
          {verdictLine(live.length)}
          {live.length > 0 ? " Undo any of them below." : ""}
        </p>

        {live.length > 0 && (
          <div className="mt-5 relative">
            {/* Spine */}
            <div className="absolute left-[15px] top-2 bottom-2 w-px bg-slate-200 dark:bg-slate-700" aria-hidden />

            <div className="flex flex-col gap-3">
              {live.map((row) => {
                const badge = bankBadgeProps(row.bankKey, 26);
                return (
                  <div key={row.key} className="relative pl-9">
                    <div className="absolute left-[11px] top-1.5 w-[9px] h-[9px] rounded-full bg-slate-300 dark:bg-slate-600 ring-4 ring-[#f0f2f7] dark:ring-[#0f172a]" aria-hidden />
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-1">{spineLabel(row)}</p>

                    <div className="glass-card rounded-2xl p-3.5">
                      <div className="flex items-center gap-2.5">
                        <BankBadge {...badge} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                            {row.displayName}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                            {row.cadence} · {badge.altText}
                          </p>
                        </div>
                        <span className="money text-sm font-semibold text-slate-800 dark:text-slate-100 shrink-0 mr-1">
                          {row.direction === "in" ? "+" : "−"}
                          {formatMoney(row.typicalAmount)}
                        </span>
                        <button
                          onClick={() => restore(row)}
                          aria-label={`Undo, bring ${row.displayName} back into projections`}
                          className="shrink-0 w-11 h-11 rounded-full bg-indigo-50 dark:bg-indigo-500/15 flex items-center justify-center active:scale-90 transition-transform"
                        >
                          <Undo2 size={17} className="text-indigo-600 dark:text-indigo-300" />
                        </button>
                      </div>

                      {row.provenance === "engine" && row.reason && (
                        <p className="mt-2.5 pt-2.5 border-t border-slate-50 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                          {row.reason}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <EntryPointMocks count={live.length} />
      </div>

      {toast && (
        <div className="fixed left-0 right-0 z-50 flex justify-center pointer-events-none" style={{ bottom: "calc(env(safe-area-inset-bottom) + 16px)" }}>
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-slate-900 dark:bg-slate-700 text-white px-4 py-3 shadow-xl max-w-[90%]">
            <p className="text-xs leading-snug">{toast.name} back in your projections from next refresh.</p>
            <button onClick={undo} className="shrink-0 text-xs font-semibold text-indigo-300 min-h-[32px] px-1">
              Undo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
