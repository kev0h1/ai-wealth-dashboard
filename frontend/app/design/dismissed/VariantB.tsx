"use client";

// TEMPORARY PREVIEW — Variant B, "two ledgers".
//
// Two sections, "Set aside by you" and "Set aside by Sorted" (derived from
// PRODUCT.md's plain, non-jargon voice rather than the internal
// dismissed_recurring / engine_vetoed_recurring names). Engine rows lead
// with their reason sentence, because the point of showing an engine row
// at all is to let the owner judge whether the call was right, reading
// comes before any action. Restore is a secondary, text-weight action on
// both sections (not a filled pill) so the row reads as information first.

import { useState } from "react";
import { bankBadgeProps } from "./bankBadge";
import { BankBadge } from "@/components/AccountMiniCard";
import { formatMoney, formatRelative, formatDate, verdictLine, type DismissedRow } from "./fixtures";
import EntryPointMocks from "./EntryPointMocks";

function Section({
  title,
  blurb,
  rows,
  leadWithReason,
  onRestore,
}: {
  title: string;
  blurb: string;
  rows: DismissedRow[];
  leadWithReason: boolean;
  onRestore: (r: DismissedRow) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-6">
      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</p>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{blurb}</p>

      <div className="mt-3 glass-card rounded-2xl overflow-hidden">
        {rows.map((row, i) => {
          const badge = bankBadgeProps(row.bankKey);
          return (
            <div key={row.key} className={`px-4 py-3.5 ${i > 0 ? "border-t border-slate-50 dark:border-slate-700" : ""}`}>
              {leadWithReason && row.reason && (
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed mb-2.5">
                  {row.reason}
                </p>
              )}

              <div className="flex items-center gap-2.5">
                <BankBadge {...badge} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {row.displayName}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    {row.cadence} · {badge.altText} · last seen {formatDate(row.lastSeen)}
                  </p>
                </div>
                <span className="money text-sm font-semibold text-slate-800 dark:text-slate-100 shrink-0">
                  {row.direction === "in" ? "+" : "−"}
                  {formatMoney(row.typicalAmount)}
                </span>
              </div>

              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  {row.provenance === "engine"
                    ? `Set aside ${formatRelative(row.vetoedAt as string)}`
                    : (row.amountNote ?? "")}
                </p>
                <button
                  onClick={() => onRestore(row)}
                  className="min-h-[36px] px-2 text-xs font-semibold text-indigo-600 dark:text-indigo-300 underline underline-offset-2 active:opacity-70"
                >
                  {row.provenance === "engine" ? "Disagree, bring it back" : "Bring it back"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function VariantB({ rows }: { rows: DismissedRow[] }) {
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

  const userRows = live.filter((r) => r.provenance === "user");
  const engineRows = live.filter((r) => r.provenance === "engine");

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-16">
      <div className="mx-auto w-full max-w-[430px] px-4 pt-6">
        <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">Set aside</h1>
        <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
          {verdictLine(live.length)}
        </p>

        <Section
          title="Set aside by you"
          blurb="You dismissed these from Planning. They won't reappear on their own."
          rows={userRows}
          leadWithReason={false}
          onRestore={restore}
        />
        <Section
          title="Set aside by Sorted"
          blurb="Sorted's engine judged these too irregular to treat as bills. Read the reason, bring any of them back if it got it wrong."
          rows={engineRows}
          leadWithReason
          onRestore={restore}
        />

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
