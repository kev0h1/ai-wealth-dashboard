"use client";

import { WalletCards, ChevronUp, ChevronRight, X } from "lucide-react";
import PennyMark from "@/components/PennyMark";
import MoneyText from "@/components/MoneyText";
import { BankBadge, BANK_META, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";

export type Variant = "a" | "b" | "c";
export type Surface = "home" | "penny";
export type Mode = "light" | "dark";
export type CardState = "default" | "minimised";

export const VARIANTS: { key: Variant; label: string }[] = [
  { key: "a", label: "A · Two-column ledger" },
  { key: "b", label: "B · Adjustment list" },
  { key: "c", label: "C · Before and after" },
];

// Same resolver PaydayPlanCard.tsx uses — copied rather than imported since
// it's a local, unexported helper there.
export function resolveBankChip(provider: string) {
  const key = bankKey({ provider });
  const meta = BANK_META[key];
  return {
    logoSrc: bankLogoSrc(meta),
    initials: meta?.initials ?? (provider || "?").slice(0, 2).toUpperCase(),
    label: meta?.label ?? (provider || "Bank"),
    bg: meta?.bg,
    initialsSize: meta?.initialsSize,
  };
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}

/** Small amber signifier dot — the one place a caution shows (Figures Are
 *  Ink; Amber Lives In The Signifier). Never used for "send less"; only for
 *  "this destination is under-funded", the genuine caution case. */
export function AmberDot() {
  return <span className="mt-[3px] block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" aria-hidden="true" />;
}

/**
 * Header chip + close control, copied verbatim from PaydayPlanCard.tsx's own
 * inline markup (the production original is inline JSX inside one default
 * export, not an importable subcomponent) — this is the UNCHANGED part of
 * the card: Penny gradient chip, title, and either the Home dismiss × or the
 * Penny minimise chevron, exactly as production renders them, never both.
 */
export function CardHeader({
  title,
  surface,
  minimised,
  onToggleMinimise,
}: {
  title: string;
  surface: Surface;
  minimised: boolean;
  onToggleMinimise: () => void;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-2">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
          <WalletCards size={17} />
        </span>
        <div className="min-w-0">
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white"
            style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
          >
            <PennyMark size={11} />
            Penny
          </span>
          <h2 className="mt-1 text-[15px] font-bold leading-5 text-slate-950 dark:text-white">{title}</h2>
        </div>
      </div>
      <button
        type="button"
        aria-label={surface === "penny" ? "Minimise" : "Dismiss"}
        onClick={onToggleMinimise}
        className="flex-shrink-0 -mt-2 -mr-2 w-11 h-11 flex items-center justify-center rounded-full touch-manipulation [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-95 transition-transform duration-150 motion-reduce:transition-none"
      >
        <span className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-900/[0.05] dark:bg-white/[0.06] border border-slate-900/[0.06] dark:border-white/10 [@media(hover:hover)]:hover:bg-slate-900/[0.09] dark:[@media(hover:hover)]:hover:bg-white/[0.11] transition-colors duration-150 motion-reduce:transition-none">
          {surface === "penny" ? (
            <ChevronUp size={14} aria-hidden="true" className={`text-slate-500 dark:text-slate-300 transition-transform duration-200 ${minimised ? "rotate-180" : ""}`} />
          ) : (
            <X size={14} aria-hidden="true" className="text-slate-500 dark:text-slate-300" />
          )}
        </span>
      </button>
    </div>
  );
}

/**
 * Salary source tile, copied verbatim from PaydayPlanCard.tsx's own
 * `item.salary` block (same reasoning as CardHeader above) — this is the
 * other UNCHANGED part every variant keeps: bank badge, expected amount,
 * "expected" caption.
 */
export function SalaryTile({ name, provider, amount }: { name: string; provider: string; amount: number }) {
  const chip = resolveBankChip(provider);
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900/30">
      <div className="flex items-center gap-2.5">
        <span className="flex-shrink-0">
          <BankBadge logoSrc={chip.logoSrc} initials={chip.initials} initialsSize={chip.initialsSize} altText={chip.label} brandBg={chip.bg} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate block">{name}</span>
        </span>
        <span className="money flex-shrink-0 text-sm font-bold text-slate-900 dark:text-slate-100">{`~£${fmt(amount)}`}</span>
      </div>
      <p className="mt-1 text-[12px] text-slate-400 dark:text-slate-500 leading-snug pl-[46px]">expected</p>
    </div>
  );
}

/** The collapsed one-line row Penny's own minimise chevron leaves behind,
 *  copied from HomeBrief.tsx's PaydayPlanSection (the same shape as its
 *  "Payday plan" collapsed row) — same convention as the month-closed-card
 *  round's MinimiseControl precedent. */
export function MinimisedRow({ subline, onExpand }: { subline: string; onExpand: () => void }) {
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-expanded={false}
      className="glass-card rounded-2xl w-full min-h-[44px] px-4 py-3 flex items-center justify-between gap-3 text-left active:scale-[0.99] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold text-slate-900 dark:text-slate-100 leading-snug">Your payday plan</span>
        <span className="block text-[13px] text-slate-500 dark:text-slate-400 leading-snug truncate">{subline}</span>
      </span>
      <ChevronRight size={16} aria-hidden="true" className="flex-shrink-0 text-slate-400 dark:text-slate-500" />
    </button>
  );
}

export function BankChipRow({ provider, name, trailing, sub }: { provider: string; name: string; trailing: React.ReactNode; sub?: React.ReactNode }) {
  const chip = resolveBankChip(provider);
  return (
    <div className="flex items-center gap-2.5 py-2">
      <span className="flex-shrink-0">
        <BankBadge logoSrc={chip.logoSrc} initials={chip.initials} initialsSize={chip.initialsSize} altText={chip.label} brandBg={chip.bg} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-700 dark:text-slate-200">{name}</span>
        {sub}
      </span>
      {trailing}
    </div>
  );
}

export { MoneyText };
