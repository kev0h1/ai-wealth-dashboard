"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { ChevronRight, CreditCard, Plus, ShieldCheck, Target } from "lucide-react";
import { useRouter } from "next/navigation";
import { api, type Account, type Commitment, type DebtPlanSummary } from "@/lib/api";
import BottomNav from "@/components/BottomNav";
import MoneyText from "@/components/MoneyText";
import { usePreferences } from "@/components/PreferencesContext";
import { useTutorialReady } from "@/components/TutorialContext";
import GrowPanel from "./GrowPanel";
import SectionJumpStrip from "./SectionJumpStrip";

const CommitmentSheet = dynamic(() => import("@/components/CommitmentSheet"));
type Loadable<T> = T | null | undefined;

function money(value: number): string {
  return `£${Math.round(value).toLocaleString("en-GB")}`;
}

function targetMonth(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? "target date unavailable"
    : date.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function nextCardCliff(view: DebtPlanSummary): { name: string; month: string } | null {
  let earliest: { name: string; until: string; time: number } | null = null;
  for (const card of view.cards) {
    for (const promo of card.rate_schedule) {
      if (promo.source !== "promo" || !promo.until) continue;
      const [year, month] = promo.until.split("-").map(Number);
      // End of the last day of that "YYYY-MM", not local midnight — matches
      // lib/planningAttention.ts's findEarliestPromoCliff so this section
      // and the jump strip's Debt dot never disagree about whether a cliff
      // is still live on its own last day.
      const time = new Date(year, month, 0, 23, 59, 59, 999).getTime();
      if (!Number.isFinite(time) || time < Date.now()) continue;
      if (!earliest || time < earliest.time) earliest = { name: card.name, until: promo.until, time };
    }
  }
  if (!earliest) return null;
  const [year, month] = earliest.until.split("-").map(Number);
  return {
    name: earliest.name,
    month: new Date(year, month - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" }),
  };
}

export function SectionHeading({ id, title, side }: { id: string; title: string; side?: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-1">
      <h2 id={id} className="text-base font-bold text-slate-800 dark:text-slate-100">{title}</h2>
      {side}
    </div>
  );
}

export function GoalRow({ goal, hideValues, onOpen }: { goal: Commitment; hideValues: boolean; onOpen: () => void }) {
  const progress = goal.amount > 0 ? Math.min(100, Math.max(0, (goal.progress / goal.amount) * 100)) : 0;
  const attention = goal.feasibility_tone === "caution" || goal.feasibility === "stretch" || !goal.on_track;
  const Icon = /buffer|emergency|rainy|safety/i.test(goal.name) ? ShieldCheck : Target;
  const amount = hideValues ? "£•••• of £••••" : `${money(goal.progress)} of ${money(goal.amount)}`;
  const cadence = goal.period_label ? `each pay period (${goal.period_label})` : "a period";
  const detail = hideValues
    ? `£•••• ${cadence} · ${goal.periods_left} left · ${targetMonth(goal.target_date)}`
    : `${money(goal.per_period_slice)} ${cadence} · ${goal.periods_left} left · ${targetMonth(goal.target_date)}`;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Edit long-term goal: ${goal.name}`}
      className="flex min-h-[70px] w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-slate-50/80 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-white/[0.035]"
    >
      <span className="relative flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
        <Icon size={15} aria-hidden="true" />
        {attention && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-white bg-amber-500 dark:border-slate-800" aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{goal.name}</span>
          <MoneyText text={amount} className="shrink-0 text-xs font-semibold text-slate-800 dark:text-slate-200" />
        </span>
        <MoneyText text={detail} className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400" />
        <span
          role="progressbar"
          aria-label={`${goal.name} funding progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          className="mt-1.5 block h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
        >
          <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${progress}%` }} />
        </span>
      </span>
      <ChevronRight size={15} className="shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
    </button>
  );
}

export function DebtPosition({ debt, hideValues, onOpen }: { debt: Loadable<DebtPlanSummary>; hideValues: boolean; onOpen: () => void }) {
  const hidden = "£••••";
  const total = debt?.cards.reduce((sum, card) => sum + Math.max(0, card.debt), 0) ?? 0;
  const buckets = debt
    ? [
        { key: "interest", amount: debt.cards.filter((card) => card.classification === "carried_interest").reduce((sum, card) => sum + Math.max(0, card.debt), 0), label: "charging interest" },
        { key: "zero", amount: debt.cards.filter((card) => card.classification === "carried_zero").reduce((sum, card) => sum + Math.max(0, card.debt), 0), label: "currently at 0%" },
        { key: "cleared", amount: debt.cards.filter((card) => card.classification === "cleared_monthly").reduce((sum, card) => sum + Math.max(0, card.debt), 0), label: "due, normally cleared" },
        { key: "unclear", amount: debt.cards.filter((card) => card.classification === "unclear" || card.classification === null).reduce((sum, card) => sum + Math.max(0, card.debt), 0), label: "repayment pattern unclear" },
      ].filter((bucket) => bucket.amount > 0.005)
    : [];
  const cliff = debt ? nextCardCliff(debt) : null;

  return (
    <section aria-labelledby="debt-position-title">
      <SectionHeading id="debt-position-title" title="Debt" side={<button type="button" onClick={onOpen} className="flex min-h-11 items-center gap-0.5 px-2 text-xs font-semibold text-indigo-600 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400">Details <ChevronRight size={13} aria-hidden="true" /></button>} />
      <div className="glass-card rounded-2xl p-4">
        {debt === undefined ? (
          <div className="space-y-3" aria-label="Loading debt position"><div className="h-5 w-40 animate-pulse rounded bg-slate-200 dark:bg-slate-700" /><div className="h-10 animate-pulse rounded bg-slate-200 dark:bg-slate-700" /></div>
        ) : debt === null ? (
          <p className="py-2 text-sm text-slate-500 dark:text-slate-400">Couldn’t load your card position. Open Details to review it.</p>
        ) : total < 0.005 ? (
          <div className="flex items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400"><CreditCard size={17} aria-hidden="true" /></span><div><p className="text-xs text-slate-500 dark:text-slate-400">Across your credit cards</p><p className="text-sm font-semibold text-slate-900 dark:text-slate-100">No balance currently owed</p></div></div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-500 dark:bg-rose-400/10 dark:text-rose-300"><CreditCard size={17} aria-hidden="true" /></span>
              <div className="min-w-0 flex-1"><p className="text-xs text-slate-500 dark:text-slate-400">Across your credit cards</p><p className="font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{hideValues ? hidden : money(total)} owed</p></div>
            </div>
            <div className={`mt-3 grid gap-x-3 gap-y-3 border-t border-slate-200/70 pt-3 dark:border-white/10 ${buckets.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
              {buckets.map((bucket) => <div key={bucket.key}><p className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{hideValues ? hidden : money(bucket.amount)}</p><p className="text-xs text-slate-500 dark:text-slate-400">{bucket.label}</p></div>)}
            </div>
            {cliff && <p className="mt-3 border-t border-slate-200/70 pt-3 text-xs text-slate-500 dark:border-white/10 dark:text-slate-400">Next 0% offer ends <span className="font-medium text-slate-700 dark:text-slate-300">{cliff.month}</span> · {cliff.name}</p>}
          </>
        )}
      </div>
      <p className="mt-2 px-1 text-xs text-slate-500 dark:text-slate-400">The amounts above add up to the total owed. Balances stay in Accounts. Repayment plans are under Details.</p>
    </section>
  );
}

export default function LongTermPlanningPage() {
  const router = useRouter();
  const { hideNetWorth } = usePreferences();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [goals, setGoals] = useState<Loadable<Commitment[]>>(undefined);
  const [debt, setDebt] = useState<Loadable<DebtPlanSummary>>(undefined);
  const [editingGoal, setEditingGoal] = useState<Commitment | null | undefined>(undefined);
  const [growReady, setGrowReady] = useState(false);

  const loadGoals = useCallback(() => {
    setGoals(undefined);
    api.listCommitments().then((response) => setGoals(response.items.filter((item) => item.status === "active"))).catch(() => setGoals(null));
  }, []);

  // Stable identity (empty deps) so passing it straight to GrowPanel's
  // `onLoaded` prop never changes on a parent re-render — an unstable
  // callback there used to retrigger GrowPanel's mount effect, causing a
  // refetch + skeleton reset every time this page re-rendered.
  const handleGrowLoaded = useCallback(() => setGrowReady(true), []);

  useEffect(() => {
    // `loadGoals` resets `setGoals(undefined)` synchronously before its
    // first `await`; react-hooks/set-state-in-effect flags calling it
    // directly here. queueMicrotask defers the call out of the effect's
    // own synchronous execution (still runs before the next paint) without
    // changing behaviour — see GrowPanel.tsx's own mount effect for the
    // same fix and fuller rationale.
    queueMicrotask(loadGoals);
    api.accounts().then(setAccounts).catch(() => setAccounts([]));
    api.getDebtPlanSummary().then(setDebt).catch(() => setDebt(null));
  }, [loadGoals]);

  useTutorialReady("planning", goals !== undefined && growReady);

  return (
    <div className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:mx-auto lg:max-w-xl lg:pb-8" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <main className="space-y-4 px-4 pt-6">
        <GrowPanel
          onLoaded={handleGrowLoaded}
          stripSlot={(view) => <SectionJumpStrip view={view} debt={debt} goals={goals} hideValues={hideNetWorth} />}
          debtSlot={
            <div id="debt" className="scroll-mt-4">
              <DebtPosition debt={debt} hideValues={hideNetWorth} onOpen={() => router.push("/cards")} />
            </div>
          }
          goalsSlot={
            <section id="commitments" className="scroll-mt-4" aria-labelledby="long-term-goals-heading" data-tutorial-id="tutorial-planning-goals">
              <SectionHeading id="long-term-goals-heading" title="Long-term goals" side={<button type="button" onClick={() => setEditingGoal(null)} className="inline-flex min-h-11 items-center gap-1 px-2 text-xs font-semibold text-indigo-600 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400"><Plus size={14} aria-hidden="true" /> Set a goal</button>} />
              <div className="glass-card overflow-hidden rounded-2xl divide-y divide-slate-200/70 dark:divide-white/10">
                {goals === undefined ? (
                  <div className="space-y-3 p-4" aria-label="Loading long-term goals"><div className="h-4 w-36 animate-pulse rounded bg-slate-200 dark:bg-slate-700" /><div className="h-1.5 animate-pulse rounded bg-slate-200 dark:bg-slate-700" /><div className="h-3 w-56 animate-pulse rounded bg-slate-200 dark:bg-slate-700" /></div>
                ) : goals === null ? (
                  <div className="p-5 text-center"><p className="text-sm text-slate-500 dark:text-slate-400">Couldn’t load your long-term goals.</p><button type="button" onClick={loadGoals} className="mt-1 min-h-11 rounded-lg px-3 text-sm font-semibold text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400">Retry</button></div>
                ) : goals.length === 0 ? (
                  <button type="button" onClick={() => setEditingGoal(null)} className="flex min-h-[92px] w-full items-center gap-3 p-4 text-left transition-colors hover:bg-slate-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-white/[0.035]">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400"><Target size={17} aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">Add a goal with a target date</span><span className="mt-1 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">See what it needs from each future pay period before you commit.</span></span>
                    <ChevronRight size={17} className="shrink-0 text-slate-400" aria-hidden="true" />
                  </button>
                ) : goals.map((goal) => <GoalRow key={goal.id} goal={goal} hideValues={hideNetWorth} onOpen={() => setEditingGoal(goal)} />)}
              </div>
            </section>
          }
        />

        <p className="px-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">One-off payments and this pay period&apos;s envelopes live in <button type="button" onClick={() => router.push("/upcoming")} className="font-semibold text-indigo-600 underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400">Upcoming</button>.</p>
      </main>

      {editingGoal !== undefined && <CommitmentSheet accounts={accounts} commitment={editingGoal} onClose={() => setEditingGoal(undefined)} onSaved={() => { setEditingGoal(undefined); loadGoals(); }} onCancelled={() => { setEditingGoal(undefined); loadGoals(); }} />}
      <BottomNav />
    </div>
  );
}
