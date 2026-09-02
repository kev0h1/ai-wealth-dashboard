"use client";

// TEMPORARY PREVIEW — Variant C, "The Brief".
//
// Position: the most restructured of the three. The verdict reads as one
// short sentence instead of a figure-plus-four-sublines-plus-banner stack
// (impeccable content-density discipline: cut ruthlessly, a number
// without a next action is unfinished, but four supporting lines under a
// number is also unfinished editing). The 90-day-basis disclaimer and the
// "payments can take a day or two" note both collapse into one tap-to-
// reveal info affordance, demoting them per the brief's hierarchy
// critique. Plans + Goals merge into one horizontal rail (a genuine
// regroup, not just restyling). The chronological list chunks into three
// super-groups (This week / Next two weeks / Next pay period) instead of
// a header per single day, and at-risk detail (culprit, pending, insight
// hint) moves behind a row-level expand rather than always-on, so the
// list's resting state is quiet and detail is opt-in.

import { useState } from "react";
import { AlertTriangle, ChevronRight, ChevronDown, Info, Plus } from "lucide-react";
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
        <span className="block w-4 h-5 rounded-b border-2 border-t-0 border-slate-300 dark:border-slate-600" />
      </button>
    </div>
  );
}

function VerdictBrief({ data }: { data: PlanningFixture }) {
  const [info, setInfo] = useState(false);
  const negative = data.runway < 0;
  const acct = data.shortfalls[0];

  return (
    <div className={`rounded-2xl px-4 py-4 ${negative ? "bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800" : "glass-hero"}`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`text-2xl font-bold tracking-tight font-mono tabular-nums ${negative ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"}`}>
          {fmtC(data.runway)}
        </p>
        <button
          type="button"
          onClick={() => setInfo((v) => !v)}
          aria-label="How this is worked out"
          className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 dark:text-slate-500 active:scale-95 transition-transform"
        >
          <Info size={16} />
        </button>
      </div>
      <p className="text-[13px] leading-snug text-slate-600 dark:text-slate-300 mt-1">
        {negative ? (
          <>
            You&apos;ll be <span className="font-mono tabular-nums font-semibold text-rose-600 dark:text-rose-400">{fmtC(Math.abs(data.runway))} short</span> before payday on {data.paydayLabel}
            {acct && <> &mdash; {acct.bank} needs attention</>}.
          </>
        ) : (
          <>To last until {data.paydayLabel}, {data.daysToPayday} days out, with room to spare.</>
        )}
      </p>
      {acct?.culprit && (
        <p className="text-[13px] leading-snug text-rose-700 dark:text-rose-300 mt-1">
          Mostly the <span className="font-mono tabular-nums">{fmtC2(acct.culprit.amount)}</span> move on {acct.culprit.dateLabel}.{" "}
          <button className="font-semibold underline-offset-2 hover:underline">Review →</button>
        </p>
      )}
      {data.timingAccounts.length > 0 && (
        <p className="text-[12px] leading-snug text-slate-500 dark:text-slate-400 mt-1 flex items-start gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400 flex-shrink-0 mt-[5px]" />
          Money&apos;s due into {data.timingAccounts[0].bank} on {data.timingAccounts[0].dueDateLabel}. If a payment leaves first, it could bounce.
        </p>
      )}
      {info && (
        <div className="mt-2 pt-2 border-t border-slate-200/60 dark:border-white/10 space-y-1">
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            <span className="font-mono tabular-nums">{fmtC(data.spendableNow)}</span> now
            {" − "}
            <span className="font-mono tabular-nums">{fmtC(data.billsTotal)}</span> bills, based on your typical spending, last 90 days.
          </p>
          {data.savingsNow > 0 && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              <span className="font-mono tabular-nums">+ {fmtC(data.savingsNow)}</span> in savings if needed.
            </p>
          )}
          {data.shortfalls.length > 0 && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Payments can take a day or two to appear, so a very recent one may not be counted yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PlansGoalsRail({ data }: { data: PlanningFixture }) {
  const cards: { key: string; label: string; sub: string; amber?: boolean }[] = [
    { key: "card", label: data.cardPlan.text, sub: "Card plan", amber: data.cardPlan.soon },
    { key: "grow", label: data.growLink.text, sub: "Grow" },
    ...data.goals.map((g) => ({ key: g.name, label: `${fmtC(g.progress)} of ${fmtC(g.amount)}`, sub: g.name })),
  ];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Plans &amp; goals</p>
        <button className="min-h-[44px] flex items-center px-2 -my-2.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 rounded-lg active:scale-95 transition-transform">
          + Plan a big expense
        </button>
      </div>
      <div className="relative -mx-4">
        <div className="flex gap-2.5 overflow-x-auto snap-x snap-mandatory px-4 pb-1">
          {cards.map((c) => (
            <button key={c.key} className="min-w-[168px] max-w-[180px] flex-shrink-0 snap-start glass-card rounded-2xl px-3.5 py-3 text-left active:scale-[0.98] transition-transform">
              <p className="text-[10.5px] text-slate-400 dark:text-slate-500 truncate flex items-center gap-1">
                {c.amber && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400" />}
                {c.sub}
              </p>
              <p className="mt-0.5 text-[13px] font-semibold text-slate-900 dark:text-slate-100 truncate">{c.label}</p>
            </button>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[var(--background)] to-transparent" />
      </div>
    </div>
  );
}

function Row({ item }: { item: PlanRow }) {
  const [open, setOpen] = useState(false);
  const vis = categoryVisual(item.category);
  const flagged = item.risk === "genuine";
  const timingRisk = item.risk === "timing";
  const hasDetail = !!(item.culprit || item.pending || item.insightHint || flagged || timingRisk || item.pooledNoOp);

  return (
    <div className="rounded-xl glass-card overflow-hidden">
      <button
        onClick={() => hasDetail && setOpen((v) => !v)}
        className="w-full px-3.5 py-2.5 flex items-center gap-3 text-left active:scale-[0.99] transition-transform"
      >
        <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: flagged ? "#ef444426" : timingRisk ? "#f59e0b26" : `${vis.colour}26` }}>
          {flagged ? <AlertTriangle size={13} className="text-rose-500" /> : <vis.icon size={13} style={{ color: timingRisk ? "#f59e0b" : vis.colour }} />}
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-[13px] font-medium truncate ${flagged ? "text-rose-700 dark:text-rose-300" : "text-slate-800 dark:text-slate-100"}`}>{item.name}</p>
          <p className="text-[10.5px] text-slate-400 dark:text-slate-500">{item.dateLabel}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className={`text-[14px] font-semibold font-mono tabular-nums ${item.type === "income" ? "text-emerald-500" : flagged ? "text-rose-600 dark:text-rose-400" : "text-slate-800 dark:text-slate-100"}`}>
            {item.type === "income" ? "+" : "−"}{fmtC2(item.amount).replace("−", "")}
          </p>
        </div>
        {hasDetail && (
          <ChevronDown size={14} className={`text-slate-300 dark:text-slate-600 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        )}
      </button>
      {open && hasDetail && (
        <div className="px-3.5 pb-3 pt-0.5 border-t border-slate-100 dark:border-white/10 space-y-1">
          {flagged && (
            <p className="text-[11px] text-rose-500 dark:text-rose-400">
              {item.bank} · only enough for what&apos;s before it
              {item.culprit && <> &mdash; includes the <span className="font-mono tabular-nums">{fmtC2(item.culprit.amount)}</span> move {item.culprit.dateLabel}</>}
            </p>
          )}
          {timingRisk && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400 flex-shrink-0" />
              {item.bank} · money&apos;s due in around now
            </p>
          )}
          {item.pooledNoOp && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">Stays in your accounts &mdash; {item.bank}</p>
          )}
          {item.pending && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">Expected {item.pending.dateLabel}, hasn&apos;t left yet</p>
          )}
          {item.insightHint && (
            <button className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
              could save ~£{item.insightHint.est} ›
            </button>
          )}
          {!flagged && !timingRisk && !item.pooledNoOp && !item.pending && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">{item.bank}</p>
          )}
          <p className="text-[10.5px] text-slate-400 dark:text-slate-500 pt-0.5">
            {item.pooledNoOp ? "pool unchanged" : <>pool after: <span className="font-mono tabular-nums">{fmtC(item.balanceAfter)}</span></>}
          </p>
        </div>
      )}
    </div>
  );
}

function chunkLabel(daysAway: number, nextPeriod: boolean | undefined): string {
  if (nextPeriod) return "Next pay period";
  if (daysAway <= 1) return "This week";
  return "Next two weeks";
}

function dayGroupToDays(label: string): number {
  if (label === "Today") return 0;
  if (label === "Tomorrow") return 1;
  const m = label.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 99;
}

export default function VariantC({ data }: { data: PlanningFixture }) {
  const chunks: { label: string; items: PlanRow[] }[] = [
    { label: "This week", items: [] },
    { label: "Next two weeks", items: [] },
    { label: "Next pay period", items: [] },
  ];
  for (const item of data.rows) {
    const label = chunkLabel(dayGroupToDays(item.dayGroup), item.nextPeriod);
    chunks.find((c) => c.label === label)!.items.push(item);
  }
  const visibleChunks = chunks.filter((c) => c.items.length > 0);

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-16">
      <div className="mx-auto w-full max-w-[430px] px-4 pt-6 space-y-4">
        <Header />
        <VerdictBrief data={data} />
        <PlansGoalsRail data={data} />

        <div className="space-y-4">
          {visibleChunks.map((c, ci) => (
            <div key={c.label}>
              {c.label === "Next pay period" && (
                <div className="flex items-center gap-3 py-1.5 mb-2">
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    from {data.nextPeriodFromLabel}
                  </span>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                </div>
              )}
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{c.label}</p>
                {ci === 0 && (
                  <button className="min-h-[44px] flex items-center px-2 -my-2.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 rounded-lg active:scale-95 transition-transform">
                    <Plus size={12} className="inline mr-0.5" />Plan a one-off
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                {c.items.map((item) => <Row key={item.id} item={item} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export { FIXTURES };
