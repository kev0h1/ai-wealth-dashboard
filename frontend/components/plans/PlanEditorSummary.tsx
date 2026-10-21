"use client";

import { ArrowDown, ArrowLeftRight, ChevronRight, CircleAlert, Info, WalletCards } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import MoneyText from "@/components/MoneyText";
import { BankBadge, accountBrand } from "@/components/AccountMiniCard";
import type { Account } from "@/lib/api";
import { useBalancesHidden } from "@/lib/balancesHidden";

type SummaryRowProps = {
  label: string;
  value: string;
  detail?: string;
  onEdit: () => void;
};

export function PlanEditorSummaryRow({ label, value, detail, onEdit }: SummaryRowProps) {
  return <button type="button" onClick={onEdit} className="w-full min-h-11 border-t border-slate-200 py-3 text-left dark:border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset">
    <span className="flex items-center gap-3">
      <span className="min-w-0 flex-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span><strong className="mt-1 block text-sm text-slate-900 dark:text-slate-100 break-words">{value}</strong>{detail && <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">{detail}</span>}</span>
      <ChevronRight size={18} className="shrink-0 text-slate-400" aria-hidden="true" />
    </span>
  </button>;
}

export function PlanContribution({ amount, cadence, progress }: { amount: number | null; cadence: string; progress?: { current: number; target: number } }) {
  const hidden = useBalancesHidden();
  if (amount == null) return null;
  const percent = progress && progress.target > 0 ? Math.min(100, Math.max(0, progress.current / progress.target * 100)) : null;
  return <section aria-label="Contribution" className="pb-4">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Contribution</p>
    <p className="mt-1 text-slate-900 dark:text-slate-100"><span className="block font-mono text-[30px] font-bold tracking-tight tabular-nums"><MoneyText text={`£${amount.toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })}`} /></span><span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">{cadence}</span></p>
    {progress && <><div role="progressbar" aria-label="Goal progress" aria-valuemin={0} aria-valuemax={hidden ? 100 : progress.target} aria-valuenow={hidden ? undefined : Math.min(progress.current, progress.target)} aria-valuetext={hidden ? "Amount hidden" : undefined} className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><span className="block h-full rounded-full bg-indigo-600" style={{ width: `${hidden ? 0 : percent}%` }} /></div><p className="mt-2 text-xs text-slate-600 dark:text-slate-300"><MoneyText text={`£${progress.current.toLocaleString("en-GB")} of £${progress.target.toLocaleString("en-GB")} set aside`} /></p></>}
  </section>;
}

export function PlanAffordability({ children, caution = false }: { children?: ReactNode; caution?: boolean }) {
  if (!children) return null;
  const Icon = caution ? CircleAlert : Info;
  return <p className="flex gap-2 border-y border-slate-200 py-3 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300"><Icon size={16} className={caution ? "mt-0.5 shrink-0 text-amber-500" : "mt-0.5 shrink-0 text-slate-400"} aria-hidden="true" />{children}</p>;
}

export function PlanRouteSummary({ source, destination, onEdit, onDestinationEdit, buttonRef, destinationButtonRef, sourceAccount, destinationAccount }: { source: string; destination: string; onEdit: () => void; onDestinationEdit?: () => void; buttonRef?: RefObject<HTMLButtonElement | null>; destinationButtonRef?: RefObject<HTMLButtonElement | null>; sourceAccount?: Account; destinationAccount?: Account }) {
  function identity(label: string, account?: Account) {
    const brand = account ? accountBrand(account) : null;
    return <span className="flex min-w-0 flex-1 items-center gap-3">
      {brand ? <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText={brand.label} brandBg={brand.background} /> : <WalletCards size={22} className="shrink-0 text-slate-500" aria-hidden="true" />}
      <span className="min-w-0"><strong className="block break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</strong>{account?.provider && <small className="mt-0.5 block text-xs text-slate-600 dark:text-slate-300">{account.provider}</small>}</span>
    </span>;
  }
  return <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700">
    <button ref={buttonRef} type="button" onClick={onEdit} aria-label="Change paying account" className="w-full px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-800">
      <span className="mb-2 block text-[11px] text-slate-600 dark:text-slate-300">Pay from</span><span className="flex items-center gap-3">{identity(source, sourceAccount)}<ChevronRight size={16} aria-hidden="true" className="shrink-0 text-slate-500" /></span>
    </button>
    <div className="flex items-center gap-2 px-4 text-xs text-slate-500 dark:text-slate-400"><ArrowDown size={13} aria-hidden="true" /><span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" /></div>
    <button ref={destinationButtonRef} type="button" onClick={onDestinationEdit ?? onEdit} aria-label="Change savings destination" className="w-full px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-800">
      <span className="mb-2 block text-[11px] text-slate-600 dark:text-slate-300">Set aside in</span><span className="flex items-center gap-3">{identity(destination, destinationAccount)}<ChevronRight size={16} aria-hidden="true" className="shrink-0 text-slate-500" /></span>
    </button>
  </div>;
}

export function PlanTrackingSummary({ label, detail, onEdit, buttonRef }: { label: string; detail: string; onEdit(): void; buttonRef?: RefObject<HTMLButtonElement | null> }) {
  return <section className="border-t border-slate-200 pt-4 dark:border-slate-700">
    <p className="mb-3 text-xs text-slate-600 dark:text-slate-300">How we recognise it</p>
    <div className="flex items-start gap-3"><span className="rounded-xl bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300"><ArrowLeftRight size={17} aria-hidden="true" /></span><div className="min-w-0"><strong className="block break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</strong><p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{detail}</p></div></div>
    <button ref={buttonRef} type="button" onClick={onEdit} className="mt-2 flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-semibold text-indigo-600 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-indigo-300">Choose a different payment<ChevronRight size={16} aria-hidden="true" /></button>
  </section>;
}
