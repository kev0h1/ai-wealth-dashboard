import type { ReactNode } from "react";
import { ArrowDown, ChevronRight, ChevronUp, WalletCards, X } from "lucide-react";
import { BANK_META, BankBadge, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import PennyMark from "@/components/PennyMark";
import type { ActualMove } from "./fixtures";

const NUMBER = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function Currency({ value, className = "", prefix = "" }: { value: number; className?: string; prefix?: string }) {
  return (
    <span className={`money ${className}`}>
      {prefix}
      {NUMBER.format(Math.round(value))}
    </span>
  );
}

// Same local resolver PaydayPlanCard.tsx and the g128 preview both carry
// (kept local rather than exported from production, matching convention).
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

export function AccountChip({ name, provider, size = 32 }: { name: string; provider: string; size?: number }) {
  const chip = resolveBankChip(provider);
  return (
    <span className="flex-shrink-0" data-account-badge={provider}>
      <BankBadge logoSrc={chip.logoSrc} initials={chip.initials} initialsSize={chip.initialsSize} altText={chip.label} brandBg={chip.bg} size={size} />
    </span>
  );
}

export function PreviewHeading({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="mb-3 px-1">
      <h2 className="text-pretty text-base font-bold text-slate-950 dark:text-white">{title}</h2>
      <p className="mt-1 max-w-2xl text-pretty text-[12px] leading-5 text-slate-500 dark:text-slate-400">{copy}</p>
    </div>
  );
}

/**
 * The Penny gradient chip + "Your payday plan" title, lifted verbatim from
 * PaydayPlanCard.tsx's own header markup (the UNCHANGED part of the card —
 * the gradient chip, PennyMark and title wording do not change for the
 * executed/past-tense state). `right` slots in whichever control this
 * variant/surface combination uses in place of PaydayPlanCard's single ×
 * (a chevron-up Minimise, a real Dismiss, both, or neither).
 */
export function CardHeader({ right }: { right?: ReactNode }) {
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
          <h2 className="mt-1 text-[15px] font-bold leading-5 text-slate-950 dark:text-white">Your payday plan</h2>
        </div>
      </div>
      {right}
    </div>
  );
}

/**
 * Minimise — the G164 fix's core affordance. Same 44px hit target and
 * glass-chip visual weight as PaydayPlanCard.tsx's existing × (copied
 * verbatim, since DismissChip/the inline × markup in HomeBrief.tsx and
 * PaydayPlanCard.tsx are local, unexported functions each card re-declares
 * its own copy of), but a chevron-up glyph and an honest "Minimise" label
 * — never an X, because collapsing back to the row is not a dismissal.
 * Used on EVERY expanded card in every variant, on BOTH surfaces: Penny's
 * plan can never be dismissed (owner rule), only minimised, and Home's
 * expanded card offers minimise alongside its own, separate real dismiss.
 */
export function MinimiseControl({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label="Minimise, back to the Already split summary"
      onClick={onClick}
      className="flex h-11 w-11 flex-shrink-0 -mr-2 -mt-2 touch-manipulation items-center justify-center rounded-full [-webkit-tap-highlight-color:transparent] transition-transform duration-150 motion-reduce:transition-none active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-900/[0.06] bg-slate-900/[0.05] transition-colors duration-150 dark:border-white/10 dark:bg-white/[0.06] [@media(hover:hover)]:hover:bg-slate-900/[0.09] dark:[@media(hover:hover)]:hover:bg-white/[0.11]">
        <ChevronUp size={14} aria-hidden="true" className="text-slate-500 dark:text-slate-300" />
      </span>
    </button>
  );
}

/**
 * Real dismiss of the whole component — Home only, per Kevin's 08:03
 * clarification. Two shapes used across the variants: this glass "×" chip
 * (the app-wide V2 dismiss-x, Kevin 2026-08-27, /design/dismiss-x — the
 * same treatment HomeBrief.tsx's local `DismissChip` renders; copied here
 * rather than imported since that function is unexported, exactly the
 * pattern PaydayPlanCard.tsx's own × already follows) for the row and Fold
 * variants, and a quiet inline text control for the Receipt variant's
 * expanded footer (`QuietDismissText` below). Never rendered on Penny.
 */
export function DismissChip({ label, onClick, className = "flex-shrink-0 -mt-2 -mr-2" }: { label: string; onClick?: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`${className} flex h-11 w-11 touch-manipulation items-center justify-center rounded-full [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-95 transition-transform duration-150 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-800`}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-900/[0.06] bg-slate-900/[0.05] transition-colors duration-150 dark:border-white/10 dark:bg-white/[0.06] [@media(hover:hover)]:hover:bg-slate-900/[0.09] dark:[@media(hover:hover)]:hover:bg-white/[0.11]">
        <X size={14} aria-hidden="true" className="text-slate-500 dark:text-slate-300" />
      </span>
    </button>
  );
}

/** Quiet inline text dismiss, Variant A's Home footer control — sits
 * beside Minimise so the card offers both without either one reading as
 * the default/primary action. Matches HomeBrief.tsx's QUIET_ACTION
 * treatment (text button, no fill, hover tint only). */
export function QuietDismissText({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 touch-manipulation items-center justify-center rounded-xl px-3 text-[13px] font-semibold text-slate-600 [-webkit-tap-highlight-color:transparent] transition-[transform,background-color] duration-150 active:scale-95 motion-reduce:transition-none [@media(hover:hover)]:hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300 dark:[@media(hover:hover)]:hover:bg-slate-700"
    >
      Dismiss
    </button>
  );
}

export function GlassCard({ children }: { children: ReactNode }) {
  return <div className="glass-card overflow-hidden rounded-2xl p-4">{children}</div>;
}

/**
 * The changed part (item 3 + item 4 of the G164 brief): a past-tense
 * receipt in the same visual grammar as PaydayPlanCard.tsx's salary
 * tile/destination ledger (rounded tile, BankBadge rows, arrow-down
 * divider, arc-close "stays with you" line), but reporting what actually
 * moved rather than the plan's own legs, and speaking of it as done, not
 * proposed. Salary reads "received" with a landed time, not "expected";
 * every standing order is one of Kevin's own accounts, bank-badged and
 * "received" — a payday split never pays an external biller directly, so
 * there is no separate "paid" row style here (review finding, G164: an
 * earlier draft invented four external-biller rows, which both broke the
 * "own accounts only" fact and overstated how real the per-row split is —
 * see fixtures.ts's own comment on what is genuinely real here).
 */
export function ReceiptLedger({
  salaryName,
  salaryProvider,
  salaryAmount,
  landedAt,
  landedDate,
  moves,
  total,
  stays,
}: {
  salaryName: string;
  salaryProvider: string;
  salaryAmount: number;
  landedAt: string;
  landedDate: string;
  moves: ActualMove[];
  total: number;
  stays: number;
}) {
  return (
    <>
      <p className="mb-2 text-[13px] leading-snug text-slate-500 dark:text-slate-400">
        Your pay landed and split automatically.
      </p>

      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="money text-[28px] font-bold tracking-tight text-slate-900 dark:text-slate-100">
            <Currency value={total} />
          </p>
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Sent across {moves.length} standing orders
          </p>
        </div>
        <p className="pb-1 text-right text-[12px] leading-4 text-slate-500 dark:text-slate-400">
          <span className="money"><Currency value={salaryAmount} /></span>
          <br />
          landed {landedAt}
        </p>
      </div>

      <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900/30">
        <div className="flex items-center gap-2.5">
          <AccountChip name={salaryName} provider={salaryProvider} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-slate-700 dark:text-slate-200">{salaryName}</span>
          </span>
          <span className="money flex-shrink-0 text-sm font-bold text-slate-900 dark:text-slate-100">
            <Currency value={salaryAmount} />
          </span>
        </div>
        <p className="mt-1 pl-[46px] text-[12px] leading-snug text-slate-400 dark:text-slate-500">
          received {landedAt}, {landedDate}
        </p>

        <div className="flex justify-center py-1" aria-hidden="true">
          <span className="grid size-7 place-items-center rounded-full border border-slate-200 bg-white text-indigo-600 dark:border-slate-600 dark:bg-slate-800 dark:text-indigo-300">
            <ArrowDown size={14} />
          </span>
        </div>
        <p className="pt-1 text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-400 dark:text-slate-500">
          Sent to {moves.length} standing orders
        </p>
        <div className="divide-y divide-slate-100 dark:divide-slate-700">
          {moves.map((move) => (
            <div key={`${move.provider}-${move.name}`} className="flex min-h-12 items-center gap-2.5 py-2">
              <AccountChip name={move.name} provider={move.provider} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-700 dark:text-slate-200">{move.name}</span>
                <span className="mt-0.5 block truncate text-[12px] leading-snug text-slate-500 dark:text-slate-400">
                  received{move.note ? ` · ${move.note}` : ""}
                </span>
              </span>
              <span className="money shrink-0 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <Currency value={move.amount} />
              </span>
            </div>
          ))}
        </div>
      </div>

      {stays > 0 && (
        <p className="mt-3 text-[13px] leading-snug text-slate-600 dark:text-slate-300">
          <Currency value={stays} /> stayed in {salaryName}.
        </p>
      )}
    </>
  );
}

/**
 * The collapsed "Already split" tap target, shared by every variant's Penny
 * surface and Variant A/C's Home surface — same 44px glass-card row and
 * ChevronRight tap affordance ExecutedPaydayRow already uses in production,
 * with the corrected what-actually-moved figure (item 4) and an optional
 * dismiss chip for the Home surfaces that offer one at the row level.
 */
export function ExecutedRow({
  label,
  onExpand,
  dismissible,
  onDismiss,
}: {
  label: string;
  onExpand?: () => void;
  dismissible?: boolean;
  onDismiss?: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onExpand}
        aria-expanded={false}
        className={`glass-card flex min-h-[44px] w-full touch-manipulation items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left [-webkit-tap-highlight-color:transparent] active:scale-[0.99] transition-transform motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${dismissible ? "pr-14" : ""}`}
      >
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold leading-snug text-slate-900 dark:text-slate-100">{label}</span>
        </span>
        <ChevronRight size={16} aria-hidden="true" className="flex-shrink-0 text-slate-400 dark:text-slate-500" />
      </button>
      {dismissible && (
        <DismissChip label="Dismiss" onClick={onDismiss} className="absolute right-1 top-1/2 -translate-y-1/2" />
      )}
    </div>
  );
}
