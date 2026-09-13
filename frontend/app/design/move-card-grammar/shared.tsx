import type { ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowRightLeft, Circle, X } from "lucide-react";
import PennyMark from "@/components/PennyMark";
import { BANK_META, BankBadge, bankKey } from "@/components/AccountMiniCard";
import type { MoveAccount, MoveScenario } from "./fixtures";

const NUMBER = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function Currency({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`font-mono tabular-nums ${className}`}>{NUMBER.format(value)}</span>;
}

function bankMeta(provider: string) {
  const meta = BANK_META[bankKey({ provider })];
  return {
    logoSrc: meta?.logoFile
      ? `/banks/${meta.logoFile}`
      : meta?.domain
        ? `https://www.google.com/s2/favicons?domain=${meta.domain}&sz=64`
        : null,
    initials: meta?.initials ?? provider.slice(0, 2).toUpperCase(),
    initialsSize: meta?.initialsSize,
    altText: meta?.label ?? provider,
    brandBg: meta?.bg,
  };
}

export function AccountBadge({ account, size = 36 }: { account: MoveAccount; size?: number }) {
  return (
    <span className="inline-flex shrink-0" data-account-badge={account.provider}>
      <BankBadge {...bankMeta(account.provider)} size={size} />
    </span>
  );
}

export function PennyStatus({ scenario }: { scenario: MoveScenario }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex h-6 items-center gap-1 rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 px-2 text-[10px] font-semibold uppercase tracking-[0.05em] text-white">
        <PennyMark size={11} />
        Penny
      </span>
      <span data-move-status className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">
        {scenario.overdue ? <Circle size={8} fill="currentColor" className="text-amber-500 dark:text-amber-400" aria-hidden="true" /> : null}
        {scenario.status}
      </span>
    </div>
  );
}

export function DismissButton() {
  return (
    <button
      type="button"
      aria-label="Hide this card"
      className="group absolute right-2 top-2 grid size-11 touch-manipulation place-items-center rounded-full [-webkit-tap-highlight-color:transparent] transition-transform duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none"
    >
      <span className="grid size-7 place-items-center rounded-full border border-slate-900/[0.06] bg-slate-900/[0.05] text-slate-500 transition-colors duration-150 group-hover:bg-slate-900/[0.09] motion-reduce:transition-none dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300 dark:group-hover:bg-white/[0.11]">
        <X size={14} aria-hidden="true" />
      </span>
    </button>
  );
}

export function MoveCardFrame({ scenario, children }: { scenario: MoveScenario; children: ReactNode }) {
  return (
    <article data-move-scenario={scenario.id} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="p-4">
        <div className="flex items-start gap-3 pr-9">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <ArrowRightLeft size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <PennyStatus scenario={scenario} />
            <h2 className="mt-1 text-pretty text-[15px] font-bold leading-6 text-slate-950 dark:text-white">
              Put this move in place
            </h2>
          </div>
        </div>
        {children}
      </div>
      <footer className="border-t border-slate-100 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/25">
        <button
          type="button"
          className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white [-webkit-tap-highlight-color:transparent] transition-[transform,background-color] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 hover:bg-indigo-700 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-800"
        >
          {scenario.primaryAction}
        </button>
      </footer>
      <DismissButton />
    </article>
  );
}

export function MoveLead({ scenario, companion }: { scenario: MoveScenario; companion: ReactNode }) {
  return (
    <div data-move-lead className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <Currency value={scenario.moving} className="text-[21px] font-bold leading-7 text-slate-950 dark:text-white" />
      <span className="text-[12px] leading-5 text-slate-500 dark:text-slate-400">{companion}</span>
    </div>
  );
}

export function PaymentLine({ scenario, compact = false }: { scenario: MoveScenario; compact?: boolean }) {
  return (
    <div data-payment-evidence className={compact ? "" : "overflow-hidden rounded-xl bg-slate-50 dark:bg-slate-900/35"}>
      <div className={`flex items-center gap-2.5 ${compact ? "py-2" : "px-3 py-2.5"}`}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{scenario.payment.name}</p>
          <p className="text-[12px] leading-4 text-slate-500 dark:text-slate-400">
            Payment {scenario.overdue ? "was due" : "due"} {scenario.payment.due}
          </p>
        </div>
        <Currency value={scenario.payment.amount} className="shrink-0 text-[13px] font-semibold text-slate-900 dark:text-slate-100" />
      </div>
      {scenario.secondaryAction ? (
        <button
          type="button"
          className={`inline-flex min-h-11 w-full touch-manipulation items-center justify-center border-t px-3 py-2 text-[12px] font-medium text-slate-600 [-webkit-tap-highlight-color:transparent] transition-[transform,background-color] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 hover:bg-slate-100 motion-reduce:transition-none dark:text-slate-300 dark:hover:bg-slate-700 ${compact ? "border-slate-100 dark:border-slate-700" : "border-slate-200/70 dark:border-slate-700"}`}
        >
          {scenario.secondaryAction}
        </button>
      ) : null}
    </div>
  );
}

export function AccountRow({ account, label, quiet = false }: { account: MoveAccount & { amount?: number }; label?: string; quiet?: boolean }) {
  return (
    <div className="flex min-h-11 items-center gap-2.5 py-1.5">
      <AccountBadge account={account} size={32} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-slate-800 dark:text-slate-100">{account.name}</p>
        {label ? <p className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">{label}</p> : null}
      </div>
      {account.amount !== undefined ? (
        <Currency value={account.amount} className={`shrink-0 text-[13px] font-semibold ${quiet ? "text-slate-600 dark:text-slate-300" : "text-slate-950 dark:text-white"}`} />
      ) : null}
    </div>
  );
}

export function RouteArrow({ horizontal = false }: { horizontal?: boolean }) {
  const Icon = horizontal ? ArrowRight : ArrowDown;
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-indigo-600 dark:border-slate-600 dark:bg-slate-800 dark:text-indigo-300">
      <Icon size={14} aria-hidden="true" />
    </span>
  );
}

export function Assurance({ scenario }: { scenario: MoveScenario }) {
  return <p className="mt-3 text-pretty text-[12px] leading-5 text-slate-500 dark:text-slate-400">{scenario.assurance}</p>;
}

export function PreviewHeading({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="mb-3 px-1">
      <h2 className="text-base font-bold text-slate-950 dark:text-white">{title}</h2>
      <p className="mt-1 max-w-2xl text-pretty text-[12px] leading-5 text-slate-500 dark:text-slate-400">{copy}</p>
    </div>
  );
}
