"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { api, CashflowData } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import { useRouter } from "next/navigation";
import {
  AmberSignifier,
  DropSentence,
  computeHeadsUp,
  totalOut,
  dueToday,
  fmtSum,
  formatShortDate,
  isSpend,
  type ComingUpBill,
} from "@/lib/comingUp";

const SYM: Record<string, string> = { UK: "£", Kenya: "KSh " };

type Status = "loading" | "ready" | "failed";

interface UpcomingBillsStripProps {
  /** Called exactly once, when this card's own fetch first settles (success
   *  or failure) — never again on a later retry. Lets HomePage's full-page
   *  loading hold know this self-fetching strip is done, since it has no
   *  other way to see into this component's own request. */
  onReady?: () => void;
}

export default function UpcomingBillsStrip({ onReady }: UpcomingBillsStripProps = {}) {
  const { region } = usePreferences();
  const sym = SYM[region] ?? "£";
  const router = useRouter();
  const [data, setData] = useState<CashflowData | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  // Latest onReady in a ref rather than a `fetch` dependency — HomePage
  // passes a fresh callback identity most renders, and this must never
  // retrigger the fetch effect below or re-fire onReady itself.
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; });
  const readyFiredRef = useRef(false);

  const fetch = useCallback(() => {
    setStatus("loading");
    api.cashflow()
      .then(d => { setData(d); setStatus("ready"); })
      .catch(() => setStatus("failed"))
      .finally(() => {
        if (readyFiredRef.current) return;
        readyFiredRef.current = true;
        onReadyRef.current?.();
      });
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  if (status === "loading") {
    // Structural skeleton — mirrors Variant E's own layout (eyebrow, a
    // two-line hero sentence block, a divider, then a footer row with the
    // bill count/total and the chevron), not Variant H's three SettleBar
    // rows. min-h floor pins it to Variant E's own measured height: 165.25px
    // (rounded up to 166), CDP at a true 430px viewport, confirmed across
    // the busy/quiet/heavy fixtures and both themes (app/design/coming-up,
    // "E · The drop" section) — a belt-and-braces guard in case the
    // placeholder's sentence happens to wrap to fewer lines than the real
    // one would.
    return (
      <div className="px-4 lg:px-0">
        <div
          className="w-full min-h-[166px] glass-card rounded-2xl px-4 py-3.5 flex flex-col animate-pulse"
          aria-hidden="true"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide rounded-full bg-slate-200 dark:bg-slate-700 text-transparent inline-block">
            Coming up &middot; 14 days
          </p>

          <div className="mt-1.5 flex flex-col gap-1.5">
            <div className="h-[18px] w-full rounded-full bg-slate-200 dark:bg-slate-700" />
            <div className="h-[18px] w-4/5 rounded-full bg-slate-200 dark:bg-slate-700" />
          </div>

          <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-[13px]">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 flex-shrink-0" />
              <span className="rounded-full bg-slate-200 dark:bg-slate-700 text-transparent inline-block">
                3 bills &middot; &pound;1,234 total
              </span>
            </p>
            <div className="w-4 h-4 rounded bg-slate-200 dark:bg-slate-700 flex-shrink-0" />
          </div>
        </div>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="px-4 lg:px-0">
        <div className="glass-card rounded-2xl px-4 py-3 flex items-center gap-3">
          <p className="text-sm text-slate-400 dark:text-slate-500 flex-1">Couldn&apos;t load upcoming bills</p>
          <button
            onClick={fetch}
            className="text-xs font-semibold text-indigo-500 dark:text-indigo-400 active:opacity-70 transition-opacity"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // The backend projects ~35 days for the Spend page; the Home strip stays
  // a 14-day glance so the count doesn't balloon. Bounded to days_away < 14
  // (today = day 0 .. day 13, a fixed 14-day window) to match the 14-slot
  // zone/day model shared with the design preview in lib/comingUp.tsx.
  //
  // Bills only — upcoming_income is never mixed in here. The old version
  // built its "all" list from bills AND income, so a same-day salary
  // landing could silently count toward "N due today" even though the
  // total underneath only summed bills. This card's job is the shape of
  // money going OUT; income belongs to Safe to Spend / Payday Plan
  // elsewhere on Home.
  const windowBills: ComingUpBill[] = data.upcoming_bills
    .filter(b => b.days_away < 14)
    .map(b => ({
      name: b.name,
      amount: b.amount,
      daysAway: b.days_away,
      date: formatShortDate(b.expected_date),
      isoDate: b.expected_date,
      kind: b.kind,
    }));

  // The headline (total/count/verdict sentence) describes SPEND only —
  // "movement" entries (transfers, savings, investment STOs) still leave
  // the account but aren't consumed, so they must never be announced as
  // what's "due". If there's genuinely nothing due in the window the card
  // hides itself, same as before, even if movement-only entries exist —
  // this card's whole job is bills, not the shape of every debit.
  const bills: ComingUpBill[] = windowBills.filter(isSpend);
  const movementBills: ComingUpBill[] = windowBills.filter(b => !isSpend(b));

  if (bills.length === 0) return null;

  const total = totalOut(bills);
  const today = dueToday(bills);
  // Quiet secondary mention only — never folded into the headline total or
  // sentence above. Movement is real money leaving the account (it stays
  // in the balance simulation elsewhere), so silently dropping it here
  // would leave the balance-conscious owner unable to reconcile "3 bills,
  // £X total" against a bigger drop in their actual balance. It's shown as
  // a plain, uncoloured addendum on the existing footer row (no new red/
  // amber signifier, no separate card row) so it can't read as a second
  // due amount or a caution.
  const movementTotal = totalOut(movementBills);

  // Deep-link target: the heaviest day in the window, unless something is
  // due today, in which case today wins. Both facts come straight out of
  // computeHeadsUp — unchanged even though the visible sentence is now
  // Variant E's (computeDrop), so the link keeps pointing at the same day
  // it always did. Dates are read off each bill's own expected_date (an
  // absolute ISO date), never derived from days_away, so the link stays
  // correct if this card is viewed a day after it was rendered. Falls back
  // to a bare /planning if nothing resolves.
  const headsUp = computeHeadsUp(bills);
  const heaviestIso = headsUp.kind === "insight" ? headsUp.heaviestLead.isoDate : undefined;
  const targetIso = today[0]?.isoDate ?? heaviestIso;
  const href = targetIso ? `/planning?day=${targetIso}` : "/planning";

  return (
    <div className="px-4 lg:px-0 fade-in">
      <button
        type="button"
        className="w-full glass-card rounded-2xl px-4 py-3.5 flex flex-col active:scale-[0.99] transition-transform text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        onClick={() => router.push(href)}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Coming up &middot; 14 days
        </p>
        <p className="mt-1 text-[18px] font-bold leading-snug text-pretty text-slate-900 dark:text-slate-100">
          <DropSentence bills={bills} sym={sym} />
        </p>
        <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-[13px] text-slate-500 dark:text-slate-400">
            <AmberSignifier show={today.length > 0} />
            <span>
              {bills.length} bill{bills.length === 1 ? "" : "s"} &middot;{" "}
              <span className="font-mono tabular-nums">{fmtSum(total, sym)}</span> total
              {movementTotal > 0 && (
                <>
                  {" "}&middot; <span className="font-mono tabular-nums">{fmtSum(movementTotal, sym)}</span> moving between your accounts
                </>
              )}
            </span>
          </p>
          <ChevronRight size={16} className="text-slate-300 dark:text-slate-600 flex-shrink-0" aria-hidden />
        </div>
      </button>
    </div>
  );
}
