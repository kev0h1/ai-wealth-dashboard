"use client";

// Shared secondary body content for /design/spend-period-round (G38): the
// miscategorised-transfers banner, the unresolved-ask card, and the "Money
// you moved" accordion. These three aren't named by the ticket's
// inconsistency (that's the notable/warm/majority figure+badge placement)
// and DESIGN.md doesn't ask this round to redesign them — they're included
// unchanged in visual language across all three variants so each variant is
// judged with the SAME real density the ticket asked for (an ask card and a
// moved accordion are genuinely part of "the whole period view"), while the
// actual art-direction differences stay concentrated on the notable/warm/
// majority tiers below them. Lightweight, variant-local copies of
// UnresolvedAskCard/MoneyYouMoved (components/SpendVerdictView.tsx) — not
// imports, see this route's own top-level note on why.

import { useState } from "react";
import { ChevronDown, ChevronUp, ReceiptText } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import type { SpendVerdictMoved, SpendVerdictUnresolved } from "@/lib/api";
import { fmt, MOVED_ICON } from "./primitives";

export function MiscategorisedBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={() => {}}
      className="w-full glass-tile rounded-xl px-3 py-2 flex items-center gap-2 active:scale-95 transition-transform"
    >
      <ReceiptText size={14} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
      <span className="flex-1 text-left text-[11px] font-medium text-slate-600 dark:text-slate-400">
        {count} transfer{count !== 1 ? "s" : ""} to review
      </span>
    </button>
  );
}

export function UnresolvedAskCard({
  largest,
  paymentsCount,
  unresolvedTotal,
  periodOut,
  accountName,
}: {
  largest: NonNullable<SpendVerdictUnresolved["largest"]>;
  paymentsCount: number;
  unresolvedTotal: number;
  periodOut: number;
  accountName?: string;
}) {
  const isGroup = paymentsCount > 1;
  const nameSlot = accountName ? `${accountName} · ${largest.date}` : largest.date;
  return (
    <div className="glass-card-flat rounded-2xl p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">
        UNPLACED · {paymentsCount} PAYMENT{paymentsCount === 1 ? "" : "S"}
      </p>
      <div className="mt-1.5 flex items-baseline gap-1.5 min-w-0">
        <span className="flex-shrink-0 font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums text-[18px]">
          {fmt(largest.amount)}
        </span>
        <span className="flex-shrink-0 text-slate-400 dark:text-slate-500 text-[13px]">·</span>
        <span className="truncate flex-1 min-w-0 text-[13px] font-normal text-slate-600 dark:text-slate-400">{nameSlot}</span>
      </div>
      <p className="mt-1.5 text-[13px] font-normal text-slate-700 dark:text-slate-300">
        {isGroup ? <>The biggest of the {paymentsCount}. I can&apos;t place it yet.</> : "I can't place this one yet."}
      </p>
      <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
        {isGroup ? (
          <>
            All {paymentsCount} together are <span className="font-mono tabular-nums">{fmt(unresolvedTotal)}</span>, counted in your{" "}
            <span className="font-mono tabular-nums">{fmt(periodOut)}</span> out.
          </>
        ) : (
          <>
            Counted in your <span className="font-mono tabular-nums">{fmt(periodOut)}</span> out.
          </>
        )}
      </p>
      <div className="flex items-center gap-4 mt-3">
        <button type="button" onClick={() => {}} className="min-h-[44px] text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity">
          Tell me what this was
        </button>
        <button type="button" onClick={() => {}} className="ml-auto min-h-[44px] text-[11px] font-medium text-slate-500 dark:text-slate-500 active:opacity-70 transition-opacity">
          Not now
        </button>
      </div>
    </div>
  );
}

export function MoneyMovedAccordion({ moved }: { moved: SpendVerdictMoved[] }) {
  const [open, setOpen] = useState(false);
  if (moved.length === 0) return null;
  const total = moved.reduce((s, m) => s + m.amount, 0);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-3 glass-card rounded-2xl"
      >
        <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
          Money you moved · <span className="font-mono tabular-nums">{fmt(total)}</span>, not counted in spending
        </p>
        {open ? <ChevronUp size={16} className="text-slate-500 dark:text-slate-400 flex-shrink-0 ml-2" /> : <ChevronDown size={16} className="text-slate-500 dark:text-slate-400 flex-shrink-0 ml-2" />}
      </button>
      {open && (
        <div className="mt-2 glass-card-flat rounded-2xl divide-y divide-slate-100 dark:divide-slate-700/50 overflow-hidden">
          {moved.map((m) => {
            const Icon = MOVED_ICON[m.kind];
            const s = m.payments_count === 1 ? "" : "s";
            const sub = m.goal_names?.length ? `${m.goal_names.join(" · ")} · ${m.payments_count} payment${s}` : `${m.payments_count} payment${s}`;
            return (
              <div key={m.kind} className="flex items-center gap-2.5 px-4 py-2.5 min-h-[44px]">
                <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-slate-100 dark:bg-slate-700/60">
                  <Icon size={13} className="text-slate-400 dark:text-slate-500" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{m.label}</p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate">{sub}</p>
                </div>
                <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-300 flex-shrink-0 font-mono tabular-nums">
                  <MoneyText text={fmt(m.amount)} />
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
