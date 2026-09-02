"use client";

// TEMPORARY PREVIEW — Variant A, "quiet ledger".
//
// One flat list, no sectioning by provenance. Provenance is carried by a
// small caption eyebrow per row ("You set this aside" / "Sorted set this
// aside") rather than a badge or grouping, so scanning the list reads like
// a plain ledger, not two competing lists. Restore sits inline on every
// row, same weight for user and engine rows, because the owner's actual
// need (get the Vanguard line back) doesn't care who set it aside.
//
// Ordering note: true chronological order needs a real dismissal
// timestamp, which `dismissed_recurring` doesn't store today (only the
// bare key). This sorts by whatever date each row actually has (engine
// rows: vetoedAt, user rows: lastSeen as the closest available proxy) —
// an honest best-effort, not a claim that user rows have a tracked
// dismissal date.

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { bankBadgeProps } from "./bankBadge";
import { BankBadge } from "@/components/AccountMiniCard";
import { formatMoney, formatRelative, formatDate, verdictLine, type DismissedRow } from "./fixtures";
import EntryPointMocks from "./EntryPointMocks";

function rowDate(r: DismissedRow): string {
  return r.provenance === "engine" ? (r.vetoedAt as string) : r.lastSeen;
}

export default function VariantA({ rows }: { rows: DismissedRow[] }) {
  const [live, setLive] = useState(rows);
  const [toast, setToast] = useState<{ name: string } | null>(null);

  function restore(row: DismissedRow) {
    setLive((prev) => prev.filter((r) => r.key !== row.key));
    setToast({ name: row.displayName });
    window.setTimeout(() => setToast(null), 5000);
  }
  function undo(row: DismissedRow) {
    setLive((prev) => [row, ...prev]);
    setToast(null);
  }

  const sorted = [...live].sort((a, b) => (rowDate(a) < rowDate(b) ? 1 : -1));
  const removedLookup = rows.filter((r) => !live.some((l) => l.key === r.key));

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-16">
      <div className="mx-auto w-full max-w-[430px] px-4 pt-6">
        <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">Set aside</h1>
        <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
          {verdictLine(live.length)}
        </p>

        {live.length > 0 && (
          <div className="mt-5 glass-card rounded-2xl overflow-hidden">
            {sorted.map((row, i) => {
              const badge = bankBadgeProps(row.bankKey);
              return (
                <div
                  key={row.key}
                  className={`px-4 py-3.5 ${i > 0 ? "border-t border-slate-50 dark:border-slate-700" : ""}`}
                >
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-1.5">
                    {row.provenance === "user"
                      ? "You set this aside"
                      : `Sorted set this aside · ${formatRelative(row.vetoedAt as string)}`}
                  </p>

                  <div className="flex items-center gap-2.5">
                    <BankBadge {...badge} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                        {row.displayName}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {row.cadence} · {row.amountNote ?? ""}
                        {row.amountNote ? " · " : ""}
                        {badge.altText} · last seen {formatDate(row.lastSeen)}
                      </p>
                    </div>
                    <span className="money text-sm font-semibold text-slate-800 dark:text-slate-100 shrink-0">
                      {row.direction === "in" ? "+" : "−"}
                      {formatMoney(row.typicalAmount)}
                    </span>
                  </div>

                  {row.provenance === "engine" && row.reason && (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      {row.reason}
                    </p>
                  )}

                  <div className="mt-2.5 flex justify-end">
                    <button
                      onClick={() => restore(row)}
                      className="min-h-[36px] flex items-center gap-1.5 px-3 rounded-full text-xs font-semibold text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/15 active:scale-95 transition-transform"
                    >
                      <RotateCcw size={13} />
                      Restore
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <EntryPointMocks count={live.length} />
      </div>

      {toast && (
        <div className="fixed left-0 right-0 z-50 flex justify-center pointer-events-none" style={{ bottom: "calc(env(safe-area-inset-bottom) + 16px)" }}>
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-slate-900 dark:bg-slate-700 text-white px-4 py-3 shadow-xl max-w-[90%]">
            <p className="text-xs leading-snug">
              {toast.name} back in your projections from next refresh.
            </p>
            <button
              onClick={() => {
                const row = removedLookup.find((r) => r.displayName === toast.name);
                if (row) undo(row);
              }}
              className="shrink-0 text-xs font-semibold text-indigo-300 min-h-[32px] px-1"
            >
              Undo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
