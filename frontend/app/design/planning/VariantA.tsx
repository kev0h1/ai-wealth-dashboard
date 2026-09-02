"use client";

// TEMPORARY PREVIEW — Variant A, "The Ledger".
//
// Position: one verdict, one surface. The red shortfall banner dissolves
// into the TO LAST hero card itself (impeccable: "cards are the lazy
// answer, nested cards are always wrong" — a second bordered rose block
// sitting directly above a rose-tinted hero card was two surfaces telling
// one story). Every at-risk row keeps its neutral glass-card background;
// red is spent ONLY on the icon chip and the amount figure, never on a
// filled card. The repeated "£400.00 move" sentence — the same fact
// stated on the banner AND on both Barclays rows on the live page — is
// told once, in the verdict card; rows carry a collapsed "Why? ›" toggle
// instead of restating it. The running-balance column drops its own red
// state entirely and is relabelled "pool left" so its meaning (the
// pooled spendable total, not a per-account figure) is explicit rather
// than assumed.

import { useState } from "react";
import { AlertTriangle, AlertCircle, Clock, ChevronRight, ChevronDown, Trash2, Plus } from "lucide-react";
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
        <Trash2 size={20} strokeWidth={1.75} className="text-slate-300 dark:text-slate-600" />
      </button>
    </div>
  );
}

function VerdictCard({ data }: { data: PlanningFixture }) {
  const negative = data.runway < 0;
  const genuine = data.shortfalls;
  const timing = data.timingAccounts;
  const hasRisk = genuine.length > 0 || timing.length > 0;

  return (
    <div
      className={`rounded-3xl px-4 py-4 ${
        genuine.length > 0
          ? "bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800"
          : "glass-hero"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-0.5">
            To last this pay period
          </p>
          <p
            className={`text-2xl font-bold tracking-tight font-mono tabular-nums ${
              negative ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"
            }`}
          >
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
        </div>
        {genuine.length > 0 && (
          <span className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400">
            <AlertTriangle size={14} />
            {genuine.length} {genuine.length === 1 ? "account" : "accounts"} short
          </span>
        )}
      </div>

      {/* The shortfall attribution — stated exactly once on the whole
          page. Rows below reference this rather than repeating it. */}
      {genuine.length > 0 && (
        <div className="mt-3 pt-3 border-t border-rose-200/70 dark:border-rose-800/60">
          {genuine.map((a) => (
            <p key={a.bank} className="text-[13px] leading-snug text-rose-900 dark:text-rose-100">
              <span className="font-semibold">{a.bank}</span> is short by{" "}
              <span className="font-mono tabular-nums font-semibold">{fmtC2(a.shortfall)}</span> before payday
              {a.culprit && (
                <>
                  , mostly the <span className="font-mono tabular-nums">{fmtC2(a.culprit.amount)}</span> move on{" "}
                  {a.culprit.dateLabel}
                </>
              )}
              .
            </p>
          ))}
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Payments can take a day or two to appear.
            </p>
            <button
              type="button"
              className="flex-shrink-0 min-h-[44px] flex items-center px-2 text-[13px] font-semibold text-rose-600 dark:text-rose-400 underline-offset-2 hover:underline active:scale-95 transition-transform"
            >
              Review →
            </button>
          </div>
        </div>
      )}

      {timing.length > 0 && (
        <div className={`mt-3 ${genuine.length === 0 ? "pt-3 border-t border-slate-200/70 dark:border-white/10" : ""}`}>
          {timing.map((t) => (
            <p key={t.bank} className="text-[12px] leading-snug text-slate-500 dark:text-slate-400 flex items-start gap-1.5">
              <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400 flex-shrink-0 mt-[5px]" />
              Money&apos;s due into {t.bank} on {t.dueDateLabel}. If a payment leaves first, it could bounce.
            </p>
          ))}
        </div>
      )}

      {!hasRisk && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 leading-snug">
          Based on your typical spending, last 90 days
        </p>
      )}
    </div>
  );
}

function PlansDock({ data }: { data: PlanningFixture }) {
  return (
    <div className="glass-card rounded-2xl divide-y divide-slate-200/60 dark:divide-white/10">
      <button className="w-full min-h-[44px] px-4 py-3 flex items-center gap-3 text-left active:scale-[0.98] transition-transform first:rounded-t-2xl">
        <p className="flex-1 min-w-0 truncate text-[15px] leading-snug text-slate-900 dark:text-slate-100">
          <span className="font-semibold">
            {data.cardPlan.soon && (
              <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400 mr-1 align-middle" />
            )}
            {data.cardPlan.text}
          </span>
          <span className="text-slate-400 dark:text-slate-500"> · </span>
          <span className="text-slate-500 dark:text-slate-400">Card plan</span>
        </p>
        <ChevronRight size={18} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
      </button>
      <button className="w-full min-h-[44px] px-4 py-3 flex items-center gap-3 text-left active:scale-[0.98] transition-transform last:rounded-b-2xl">
        <p className="flex-1 min-w-0 truncate text-[15px] leading-snug text-slate-900 dark:text-slate-100">
          <span className="font-semibold font-mono tabular-nums">{data.growLink.text}</span>
          <span className="text-slate-400 dark:text-slate-500"> · </span>
          <span className="text-slate-500 dark:text-slate-400">Grow</span>
        </p>
        <ChevronRight size={18} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
      </button>
    </div>
  );
}

function GoalsBlock({ data }: { data: PlanningFixture }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button className="min-h-[44px] flex items-center px-2 -my-2.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 rounded-lg active:scale-95 transition-transform">
          + Plan a big expense
        </button>
      </div>
      {data.goals.map((g) => {
        const pct = g.amount > 0 ? Math.min(100, Math.max(0, (g.progress / g.amount) * 100)) : 0;
        return (
          <button key={g.name} className="w-full text-left glass-card rounded-2xl px-4 py-3 active:scale-[0.98] transition-transform">
            <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{g.name}</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">{g.monthLabel}</p>
            <div className="mt-2 h-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div className={`h-full rounded-full ${g.onTrack ? "bg-indigo-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 text-[13px] font-semibold text-slate-800 dark:text-slate-100">
              <span className="font-mono tabular-nums">{fmtC(g.progress)}</span>{" "}
              <span className="font-normal text-slate-400 dark:text-slate-500">of <span className="font-mono tabular-nums">{fmtC(g.amount)}</span></span>
            </p>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-mono tabular-nums">{fmtC(g.perPeriod)}</span> each pay period · {g.periodsLeft} left
            </p>
            {g.feasibilityNote && (
              <p className="mt-1 flex items-start gap-1.5 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[3px] bg-amber-500" />
                <span className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">{g.feasibilityNote}</span>
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Row({ item, isFirstInGroup, onPlanOneOff }: { item: PlanRow; isFirstInGroup: boolean; onPlanOneOff: () => void }) {
  const [why, setWhy] = useState(false);
  const vis = categoryVisual(item.category);
  const flagged = item.risk === "genuine";
  const timingRisk = item.risk === "timing";
  const isSettling = !!item.isSettling;

  return (
    <div className="rounded-2xl px-4 py-3 flex items-center gap-3 glass-card">
      {flagged ? (
        <span className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center flex-shrink-0 text-rose-500">
          <AlertTriangle size={14} />
        </span>
      ) : timingRisk ? (
        <span className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0 text-amber-500 dark:text-amber-400">
          <AlertCircle size={14} />
        </span>
      ) : isSettling ? (
        // Neutral slate, never the category colour — a "Debt" category row
        // (brand colour #f87171, a red hue) would otherwise leak a
        // red-looking chip onto a row that already resolved.
        <span className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0 text-slate-400 dark:text-slate-500">
          <Clock size={14} />
        </span>
      ) : (
        <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${vis.colour}26` }}>
          <vis.icon size={15} style={{ color: vis.colour }} />
        </span>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className={`text-sm font-medium truncate ${flagged ? "text-rose-700 dark:text-rose-300" : "text-slate-800 dark:text-slate-100"}`}>
            {item.name}
          </p>
          {item.edited && (
            <span className="flex-shrink-0 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded-md">edited</span>
          )}
        </div>

        {flagged && (
          <p className="text-[11px] font-semibold text-rose-500 dark:text-rose-400 truncate flex items-center gap-1.5">
            {item.bank} · low balance
            {item.culprit && (
              <button
                type="button"
                onClick={() => setWhy((w) => !w)}
                className="font-medium text-rose-400 dark:text-rose-500 underline-offset-2 hover:underline"
              >
                Why? {why ? <ChevronDown size={10} className="inline" /> : "›"}
              </button>
            )}
          </p>
        )}
        {flagged && why && item.culprit && (
          <p className="text-[11px] text-rose-500 dark:text-rose-400 truncate">
            Includes the <span className="font-mono tabular-nums">{fmtC2(item.culprit.amount)}</span> move {item.culprit.dateLabel}
          </p>
        )}
        {timingRisk && (
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 min-w-0">
            <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400 flex-shrink-0" />
            <span className="truncate">{item.bank} · money&apos;s due in around now</span>
          </p>
        )}
        {item.pooledNoOp && (
          <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{item.bank} · own transfer</p>
        )}
        {!flagged && !timingRisk && !item.pooledNoOp && (
          <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{item.bank}</p>
        )}

        {item.insightHint && !isSettling && (
          <button className="min-h-[44px] flex items-center -my-2.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline underline-offset-2">
            <span>could save <span className="font-mono tabular-nums">~£{item.insightHint.est}</span> ›</span>
          </button>
        )}

        <p className="text-[11px] text-slate-500 dark:text-slate-400">{item.dateLabel}</p>

        {/* Same state voice as the live page: calm, never red, the money
            has already left per the bank, the settled feed just hasn't
            caught up yet. */}
        {isSettling && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
            Left earlier today, still settling
          </p>
        )}

        {item.pending && (
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            expected {item.pending.dateLabel}, hasn&apos;t left yet
          </p>
        )}
      </div>

      <div className="text-right flex-shrink-0">
        <p className={`text-base font-mono tabular-nums ${
          item.type === "income" ? "font-bold text-emerald-500" :
          flagged ? "font-bold text-rose-600 dark:text-rose-400" :
          isSettling ? "font-semibold text-slate-500 dark:text-slate-400" :
          "font-bold text-slate-800 dark:text-slate-100"
        }`}>
          {item.type === "income" ? "+" : "−"}{fmtC2(item.amount).replace("−", "")}
        </p>
        {isSettling ? (
          <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500">settling</p>
        ) : item.pooledNoOp ? (
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">stays in pool</p>
        ) : (
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            <span className="font-mono tabular-nums">{fmtC(item.balanceAfter)}</span> pool left
          </p>
        )}
      </div>

      {isFirstInGroup && (
        <button
          onClick={onPlanOneOff}
          className="sr-only"
          aria-hidden
        />
      )}
    </div>
  );
}

export default function VariantA({ data }: { data: PlanningFixture }) {
  const groups: { label: string; items: PlanRow[] }[] = [];
  for (const item of data.rows) {
    let g = groups.find((g) => g.label === item.dayGroup);
    if (!g) { g = { label: item.dayGroup, items: [] }; groups.push(g); }
    g.items.push(item);
  }
  let dividerShown = false;

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-16">
      <div className="mx-auto w-full max-w-[430px] px-4 pt-6 space-y-4">
        <Header />
        <VerdictCard data={data} />
        <PlansDock data={data} />
        <GoalsBlock data={data} />

        <div className="space-y-3">
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
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{g.label}</p>
                  {gi === 0 && (
                    <button className="min-h-[44px] flex items-center px-2 -my-2.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 rounded-lg active:scale-95 transition-transform">
                      <Plus size={12} className="inline mr-0.5" />Plan a one-off
                    </button>
                  )}
                </div>
                {(() => {
                  // Settling rows cluster at the end of the day group under
                  // their own quiet sub-header, mirroring the live page's
                  // renderGroups — see its own comment for why this is
                  // nested per-day rather than a page-level section.
                  const settlingItems = g.items.filter((i) => i.isSettling);
                  const activeItems = g.items.filter((i) => !i.isSettling);
                  return (
                    <>
                      {activeItems.length > 0 && (
                        <div className="space-y-2">
                          {activeItems.map((item) => (
                            <Row key={item.id} item={item} isFirstInGroup={false} onPlanOneOff={() => {}} />
                          ))}
                        </div>
                      )}
                      {settlingItems.length > 0 && (
                        <div className={activeItems.length > 0 ? "mt-3" : ""}>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5">
                            Settling
                          </p>
                          <div className="space-y-2">
                            {settlingItems.map((item) => (
                              <Row key={item.id} item={item} isFirstInGroup={false} onPlanOneOff={() => {}} />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { FIXTURES };
