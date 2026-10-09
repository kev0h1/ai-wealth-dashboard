"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, Info, TriangleAlert } from "lucide-react";
import { BANK_META, BankBadge, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";
import type { Plan } from "@/lib/upcomingPlans";
import { FINE_FOLD_KEY, money, statusFor, type AccountStatus } from "@/lib/upcomingAccountStatus";

export interface UpcomingAccountsCardProps {
  accounts: UpcomingAccountSummary[];
  periodLabel: string;
  onOpen: (account: UpcomingAccountSummary) => void;
  plans?: Plan[];
  plansStatus?: "loading" | "error" | "ready";
  onRetry?: () => void;
}

const focus = "touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500";

function Signal({ signal }: { signal: AccountStatus["signal"] }) {
  const colour = signal === "risk" ? "text-rose-600 dark:text-rose-400" : signal === "unknown" ? "text-slate-500 dark:text-slate-400" : "text-amber-700 dark:text-amber-400";
  const Icon = signal === "risk" ? TriangleAlert : Info;
  return <span data-status-signal={signal ?? "none"} aria-hidden="true" className={`col-start-3 row-start-1 flex h-5 w-4 items-center justify-center ${colour}`}>
    {signal && <Icon size={14} strokeWidth={2} />}
  </span>;
}

function AccountRow({ account, result, onOpen }: { account: UpcomingAccountSummary; result: AccountStatus; onOpen: (account: UpcomingAccountSummary) => void }) {
  const meta = BANK_META[bankKey({ provider: account.bank })];
  return <button
    type="button"
    data-account-row={account.id}
    onClick={() => onOpen(account)}
    aria-label={`Open ${account.bank}, ${account.name}: ${result.amount === null ? result.label : `${money(result.amount)}, ${result.label.toLowerCase()}`}${result.estimated ? ", estimated" : ""}`}
    className={`grid min-h-16 w-full grid-cols-[2rem_minmax(0,1fr)_1rem_minmax(0,8rem)] items-start gap-x-2 px-3 py-3 text-left hover:bg-slate-50 active:opacity-70 min-[360px]:px-4 dark:hover:bg-slate-700/50 ${focus}`}
  >
    <span data-bank-badge className="col-start-1 row-span-3 row-start-1 w-8 pt-0.5"><BankBadge logoSrc={bankLogoSrc(meta)} initials={meta?.initials ?? account.bank.slice(0, 2).toUpperCase()} initialsSize={meta?.initialsSize} altText="" brandBg={meta?.bg} size={32} /></span>
    <span className="col-start-2 row-span-3 row-start-1 min-w-0 pr-1">
      <span className="block break-words text-sm font-semibold leading-5 text-slate-800 dark:text-slate-100">{account.bank}</span>
      <span className="mt-0.5 block break-words text-xs leading-4 text-slate-600 dark:text-slate-400">{account.name}</span>
    </span>
    <Signal signal={result.signal} />
    <span data-status-amount className={`col-start-4 row-start-1 whitespace-nowrap text-right text-sm font-bold leading-5 text-slate-900 dark:text-slate-100 ${result.amount === null ? "font-sans" : "font-mono tabular-nums"}`}>{result.amount === null ? "Unavailable" : money(result.amount)}</span>
    <span data-status-caption className="col-span-2 col-start-3 row-start-2 mt-0.5 text-right font-sans text-xs leading-4 text-slate-600 dark:text-slate-300">{result.label}</span>
    {result.estimated && <span data-status-estimate className="col-span-2 col-start-3 row-start-3 text-right font-sans text-xs leading-4 text-slate-600 dark:text-slate-400">Estimated</span>}
  </button>;
}

/** Attention order: short for payments, then short for plans, then watch
 *  states (an optional transfer the account cannot fund, or a calculation
 *  that could not be confirmed). Accounts with no signal are fine. */
const TIER: Record<NonNullable<AccountStatus["signal"]>, number> = { risk: 0, plan: 1, move: 2, unknown: 2 };

/**
 * Account-level evidence for the Upcoming hero. It receives already-derived
 * values only: this component must never alter the pooled runway calculation.
 */
export default function UpcomingAccountsCard({ accounts, periodLabel, onOpen, plans = [], plansStatus = "ready", onRetry }: UpcomingAccountsCardProps) {
  const headingId = useId();
  const readyPlans = plansStatus === "ready" ? plans : [];
  const regionId = useId();
  const [open, setOpen] = useState(false);
  // Animate only after a tap, never when restoring the remembered state.
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    try { if (sessionStorage.getItem(FINE_FOLD_KEY) === "1") setOpen(true); } catch {}
  }, []);
  const toggle = () => {
    const next = !open;
    setAnimate(true);
    setOpen(next);
    try { if (next) sessionStorage.setItem(FINE_FOLD_KEY, "1"); else sessionStorage.removeItem(FINE_FOLD_KEY); } catch {}
  };
  const { attention, fine } = useMemo(() => {
    const rows = accounts.map((account) => ({ account, result: statusFor(plansStatus === "ready" ? account : { ...account, position: undefined }, readyPlans) })); // G238: payments-only until plans are ready
    return {
      attention: rows.filter((row) => row.result.signal !== null).sort((a, b) => TIER[a.result.signal!] - TIER[b.result.signal!]),
      fine: rows.filter((row) => row.result.signal === null),
    };
  }, [accounts, readyPlans, plansStatus]);
  const allClear = accounts.length > 0 && attention.length === 0;
  const foldLabel = allClear ? (fine.length === 1 ? "1 account" : `All ${fine.length} accounts`) : `${fine.length} ${fine.length === 1 ? "account is" : "accounts are"} fine${plansStatus === "ready" ? "" : " for payments"}`;

  return (
    <section aria-labelledby={headingId} data-account-status-card="b" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="px-4 pb-3 pt-4">
        <h2 id={headingId} className="text-base font-bold text-slate-950 dark:text-slate-50">By account</h2>
        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{periodLabel}</p>
      </div>
      {accounts.length === 0 ? (
        <p className="border-t border-slate-100 px-4 py-4 text-sm leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300">No account payments are expected in this period.</p>
      ) : (
        <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-700 dark:border-slate-700">
          {allClear && <p data-all-clear className="px-4 py-4 text-sm leading-5 text-slate-700 dark:text-slate-200">{plansStatus === "ready" ? "Every paying account covers its payments and plans this period." : "Every paying account covers its payments this period."}</p>}
          {attention.map(({ account, result }) => <AccountRow key={account.id} account={account} result={result} onOpen={onOpen} />)}
          {fine.length > 0 && <div data-fine-group>
            {/* Fine accounts fold behind one quiet row. Same grid-template-rows 0fr/1fr
                convention and inert-when-collapsed as Planning's CollapsibleRungs; rows
                stay in the DOM so nothing is fetched or laid out again on expand. */}
            <button type="button" data-fine-fold aria-expanded={open} aria-controls={regionId} onClick={toggle} className={`flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm text-slate-600 hover:bg-slate-50 active:opacity-70 min-[360px]:px-4 dark:text-slate-300 dark:hover:bg-slate-700/50 ${focus}`}>
              <span>{foldLabel}</span>
              <ChevronDown aria-hidden="true" size={16} className={`shrink-0 ${animate ? "transition-transform motion-reduce:transition-none" : ""} ${open ? "rotate-180" : ""}`} />
            </button>
            <div id={regionId} data-fine-region inert={!open} className={`grid ${animate ? "transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none" : ""} ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
              <div className="min-h-0 overflow-hidden">
                <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-700 dark:border-slate-700">
                  {fine.map(({ account, result }) => <AccountRow key={account.id} account={account} result={result} onOpen={onOpen} />)}
                </div>
              </div>
            </div>
          </div>}
        </div>
      )}
      {plansStatus !== "ready" && <div className="border-t border-slate-100 px-4 py-3 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300" role="status">{plansStatus === "loading" ? "Loading goals and allocations. Figures show payments only." : "Goals and allocations could not be checked. Figures show payments only."}{plansStatus === "error" && onRetry && <button type="button" className={`ml-1 min-h-11 rounded-lg px-2 font-semibold text-indigo-600 hover:bg-indigo-50 active:opacity-70 dark:text-indigo-300 dark:hover:bg-indigo-400/10 ${focus}`} onClick={onRetry}>Try again</button>}</div>}
      {accounts.length > 0 && <p className="px-4 pb-4 pt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">Tap an account for its working.</p>}
    </section>
  );
}
