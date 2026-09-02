"use client";

// TEMPORARY PREVIEW — Variant B, "The Timeline".
//
// Position: the hero card stays close to the live shape (owner already
// picked this card's bones), but the shortfall banner compresses into a
// small "watch" strip of account chips inside the same card, and the
// culprit sentence is told ONCE, directly under that strip — no row below
// ever repeats it. Rows instead carry a small "*" reference mark that
// scrolls back up to the explanation on tap, the footnote model rather
// than restating the same £400.00 move on every affected row. The list
// itself is labelled once ("running total across your spendable
// accounts") so the pool-left column's meaning is explicit, then renders
// quieter (smaller, lighter) than the live page's heavy right-aligned
// mono column.

import { useRef } from "react";
import { AlertTriangle, ChevronRight, Plus } from "lucide-react";
import { FIXTURES, fmtC, fmtC2, type PlanningFixture, type PlanRow } from "./fixtures";
import { categoryVisual } from "./categoryVisuals";

function Header() {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">
          PLANNING
        </p>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">What&apos;s coming</h1>
      </div>
      <button
        type="button"
        aria-label="Set aside"
        className="relative shrink-0 w-11 h-11 rounded-xl flex items-center justify-center active:scale-95 transition-transform"
      >
        <span className="w-5 h-5 block rounded-sm border-2 border-slate-300 dark:border-slate-600" />
      </button>
    </div>
  );
}

function VerdictCard({ data, explainRef }: { data: PlanningFixture; explainRef: React.RefObject<HTMLDivElement | null> }) {
  const negative = data.runway < 0;
  return (
    <div className={`rounded-2xl px-4 py-4 ${negative ? "bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800" : "glass-hero"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-0.5">
        To last this pay period
      </p>
      <p className={`text-2xl font-bold tracking-tight font-mono tabular-nums ${negative ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"}`}>
        {fmtC(data.runway)}
      </p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
        <span className="font-mono tabular-nums">{fmtC(data.spendableNow)}</span> now
        {" − "}
        <span className="font-mono tabular-nums">{fmtC(data.billsTotal)}</span> bills{" "}
        · ends {data.paydayLabel} ({data.daysToPayday} days)
      </p>
      {data.savingsNow > 0 && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 leading-snug">
          <span className="font-mono tabular-nums">+ {fmtC(data.savingsNow)}</span> in savings if needed
        </p>
      )}

      {(data.shortfalls.length > 0 || data.timingAccounts.length > 0) && (
        <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-white/10">
          <div className="flex flex-wrap gap-1.5">
            {data.shortfalls.map((a) => (
              <span key={a.bank} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400">
                <AlertTriangle size={11} /> {a.bank} <span className="font-mono tabular-nums">{fmtC2(-a.shortfall)}</span>
              </span>
            ))}
            {data.timingAccounts.map((t) => (
              <span key={t.bank} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400">
                {t.bank} · due {t.dueDateLabel}
              </span>
            ))}
            {data.shortfalls.length > 0 && (
              <button className="inline-flex items-center min-h-[28px] px-2.5 rounded-lg text-[11px] font-semibold text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 active:scale-95 transition-transform">
                Review
              </button>
            )}
          </div>
          {data.shortfalls.length > 0 && (
            <div ref={explainRef}>
              <p className="mt-2 text-[12px] leading-snug text-rose-700 dark:text-rose-300">
                Because of the <span className="font-mono tabular-nums">{fmtC2(data.shortfalls[0].culprit!.amount)}</span> move on {data.shortfalls[0].culprit!.dateLabel}.
              </p>
            </div>
          )}
        </div>
      )}
      {data.shortfalls.length === 0 && data.timingAccounts.length === 0 && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 leading-snug">
          Based on your typical spending, last 90 days
        </p>
      )}
    </div>
  );
}

function PlansAndGoals({ data }: { data: PlanningFixture }) {
  return (
    <div className="space-y-2">
      <div className="glass-card rounded-2xl divide-y divide-slate-200/60 dark:divide-white/10">
        <button className="w-full min-h-[44px] px-4 py-3 flex items-center gap-3 text-left active:scale-[0.98] transition-transform first:rounded-t-2xl">
          <p className="flex-1 min-w-0 truncate text-[14px] leading-snug text-slate-900 dark:text-slate-100">
            <span className="font-semibold">
              {data.cardPlan.soon && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400 mr-1 align-middle" />}
              {data.cardPlan.text}
            </span>
            <span className="text-slate-400 dark:text-slate-500"> · </span>
            <span className="text-slate-500 dark:text-slate-400">Card plan</span>
          </p>
          <ChevronRight size={18} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
        </button>
        <button className="w-full min-h-[44px] px-4 py-3 flex items-center gap-3 text-left active:scale-[0.98] transition-transform last:rounded-b-2xl">
          <p className="flex-1 min-w-0 truncate text-[14px] leading-snug text-slate-900 dark:text-slate-100">
            <span className="font-semibold font-mono tabular-nums">{data.growLink.text}</span>
            <span className="text-slate-400 dark:text-slate-500"> · </span>
            <span className="text-slate-500 dark:text-slate-400">Grow</span>
          </p>
          <ChevronRight size={18} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
        </button>
      </div>

      <div className="flex justify-end">
        <button className="min-h-[44px] flex items-center px-2 -my-2.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 rounded-lg active:scale-95 transition-transform">
          + Plan a big expense
        </button>
      </div>
      {data.goals.map((g) => {
        const pct = g.amount > 0 ? Math.min(100, Math.max(0, (g.progress / g.amount) * 100)) : 0;
        return (
          <button key={g.name} className="w-full text-left glass-card rounded-2xl px-4 py-3 active:scale-[0.98] transition-transform">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{g.name}</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 flex-shrink-0">{g.monthLabel}</p>
            </div>
            <div className="mt-2 h-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div className={`h-full rounded-full ${g.onTrack ? "bg-indigo-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                <span className="font-mono tabular-nums">{fmtC(g.progress)}</span>{" "}
                <span className="font-normal text-slate-400 dark:text-slate-500">of <span className="font-mono tabular-nums">{fmtC(g.amount)}</span></span>
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 flex-shrink-0">{g.periodsLeft} left</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Row({ item, footnote, onFootnoteTap }: { item: PlanRow; footnote: boolean; onFootnoteTap: () => void }) {
  const vis = categoryVisual(item.category);
  const flagged = item.risk === "genuine";
  const timingRisk = item.risk === "timing";

  return (
    <div className="rounded-xl px-3 py-2.5 flex items-center gap-3 glass-card">
      <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: flagged ? "#ef444426" : timingRisk ? "#f59e0b26" : `${vis.colour}26` }}>
        <vis.icon size={13} style={{ color: flagged ? "#ef4444" : timingRisk ? "#f59e0b" : vis.colour }} />
      </span>

      <div className="flex-1 min-w-0">
        <p className={`text-[13px] font-medium truncate ${flagged ? "text-rose-700 dark:text-rose-300" : "text-slate-800 dark:text-slate-100"}`}>
          {item.name}
          {footnote && (
            <button onClick={onFootnoteTap} className="ml-1 text-rose-400 dark:text-rose-500 font-semibold">*</button>
          )}
        </p>
        <p className="text-[10.5px] text-slate-400 dark:text-slate-500 truncate">
          {item.pooledNoOp ? `${item.bank} · own transfer` : timingRisk ? `${item.bank} · low balance` : flagged ? `${item.bank} · low balance` : item.bank}
          {" · "}{item.dateLabel}
        </p>
        {item.pending && (
          <p className="text-[10.5px] text-slate-400 dark:text-slate-500">hasn&apos;t left yet</p>
        )}
        {item.insightHint && (
          <button className="text-[10.5px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
            could save ~£{item.insightHint.est} ›
          </button>
        )}
      </div>

      <div className="text-right flex-shrink-0">
        <p className={`text-[14px] font-semibold font-mono tabular-nums ${item.type === "income" ? "text-emerald-500" : flagged ? "text-rose-600 dark:text-rose-400" : "text-slate-800 dark:text-slate-100"}`}>
          {item.type === "income" ? "+" : "−"}{fmtC2(item.amount).replace("−", "")}
        </p>
        <p className="text-[10px] text-slate-400 dark:text-slate-500">{item.pooledNoOp ? "pool unchanged" : fmtC(item.balanceAfter)}</p>
      </div>
    </div>
  );
}

export default function VariantB({ data }: { data: PlanningFixture }) {
  const explainRef = useRef<HTMLDivElement>(null);
  const groups: { label: string; items: PlanRow[] }[] = [];
  for (const item of data.rows) {
    let g = groups.find((g) => g.label === item.dayGroup);
    if (!g) { g = { label: item.dayGroup, items: [] }; groups.push(g); }
    g.items.push(item);
  }
  let dividerShown = false;
  const scrollToExplain = () => explainRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-16">
      <div className="mx-auto w-full max-w-[430px] px-4 pt-6 space-y-4">
        <Header />
        <VerdictCard data={data} explainRef={explainRef} />
        <PlansAndGoals data={data} />

        <div className="space-y-3">
          {data.shortfalls.length > 0 && (
            <p className="px-1 text-[10.5px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500">
              Running total across your spendable accounts
            </p>
          )}
          {groups.map((g, gi) => {
            const isNextPeriod = g.items.every((i) => i.nextPeriod);
            const showDivider = isNextPeriod && !dividerShown;
            if (showDivider) dividerShown = true;
            return (
              <div key={g.label}>
                {showDivider && (
                  <div className="flex items-center gap-3 py-1.5 mb-2">
                    <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      Next pay period · from {data.nextPeriodFromLabel}
                    </span>
                    <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{g.label}</p>
                  {gi === 0 && (
                    <button className="min-h-[44px] flex items-center px-2 -my-2.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 rounded-lg active:scale-95 transition-transform">
                      <Plus size={12} className="inline mr-0.5" />Plan a one-off
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {g.items.map((item) => (
                    <Row key={item.id} item={item} footnote={item.risk === "genuine"} onFootnoteTap={scrollToExplain} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { FIXTURES };
