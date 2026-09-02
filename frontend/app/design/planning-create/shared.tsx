"use client";

// Shared building blocks for the three /design/planning-create variants —
// kept identical across A/B/C so the comparison is about the CREATE FLOW and
// entry mechanism, not incidental card-styling drift. Card markup mirrors
// PlanningPage.tsx's CommitmentsBlock/AllocationsBlock renderers closely
// (same glass-card shell, progress-bar treatment, money-is-mono figures);
// it is a faithful representative replica, not a byte-identical port — the
// exact upcoming-list row markup isn't this round's subject, the creation
// mechanism is.

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { accountBrand, BankBadge } from "@/components/AccountMiniCard";
import type { Account, Commitment, Allocation } from "@/lib/api";

const fmt = (n: number) => "£" + Math.round(n).toLocaleString("en-GB");

// ── Page shell ──────────────────────────────────────────────────────────

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-24">
      <div className="mx-auto w-full max-w-[390px] px-4 pt-6 space-y-8">{children}</div>
    </div>
  );
}

export function SectionLabel({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
        {children}
      </p>
      {sub && <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">{sub}</p>}
    </div>
  );
}

// ── Resulting cards (identical in every variant) ───────────────────────

export function GoalCardMock({ c }: { c: Commitment }) {
  const pct = c.amount > 0 ? Math.min(100, Math.max(0, (c.progress / c.amount) * 100)) : 0;
  const month = new Date(c.target_date).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  return (
    <div className="w-full text-left glass-card rounded-2xl px-4 py-3">
      <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{c.name}</p>
      <p className="text-[11px] text-slate-400 dark:text-slate-500">{month}</p>
      <div className="mt-2 h-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden" aria-hidden="true">
        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-[13px] font-semibold text-slate-800 dark:text-slate-100">
        <span className="font-mono tabular-nums">{fmt(c.progress)}</span>{" "}
        <span className="font-normal text-slate-400 dark:text-slate-500">
          of <span className="font-mono tabular-nums">{fmt(c.amount)}</span>
        </span>
      </p>
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="font-mono tabular-nums">{fmt(c.per_period_slice)}</span>
        {c.period_label ? ` each pay period (${c.period_label}) · ${c.periods_left} left` : ` a period · ${c.periods_left} left`}
      </p>
    </div>
  );
}

export function AllocationCardMock({
  a,
  accounts,
  recurrence,
}: {
  a: Allocation;
  accounts: Account[];
  /** Owner correction, 2026-08-29: an envelope's recurrence is no longer
   * assumed "every period" — render the rhythm explicitly so the card is
   * honest about which kind it is. Optional so any pre-existing call site
   * (or a stale payload) still renders, defaulting to the recurring read. */
  recurrence?: "every_period" | "once";
}) {
  const pct = a.amount_per_period > 0 ? Math.min(100, Math.max(0, (a.filled_this_period / a.amount_per_period) * 100)) : 0;
  const feedAccount = accounts.find((acc) => acc.id === a.fill_account_id);
  const feedLabel = a.fill_display_name || feedAccount?.name;
  const rhythmLabel = recurrence === "once" ? "This period only" : "Every pay period";
  return (
    <div className="w-full text-left glass-card rounded-2xl px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{a.name}</p>
        <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mt-0.5">
          {rhythmLabel}
        </span>
      </div>
      {feedLabel && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">fed by {feedLabel}</p>
      )}
      <div className="mt-2 h-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden" aria-hidden="true">
        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-[13px] font-semibold text-slate-800 dark:text-slate-100">
        <span className="font-mono tabular-nums">{fmt(a.filled_this_period)}</span>{" "}
        <span className="font-normal text-slate-400 dark:text-slate-500">
          of <span className="font-mono tabular-nums">{fmt(a.amount_per_period)}</span> this period
        </span>
      </p>
    </div>
  );
}

export function OneOffRowMock({
  name,
  amount,
  dateLabel,
  account,
}: {
  name: string;
  amount: number;
  dateLabel: string;
  account?: Account;
}) {
  return (
    <div className="glass-card rounded-2xl px-4 py-3 flex items-center gap-3">
      {account && (
        <BankBadge
          logoSrc={accountBrand(account).logoSrc}
          initials={accountBrand(account).initials}
          altText={accountBrand(account).label}
          brandBg={accountBrand(account).background}
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{name}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          {dateLabel}
          {account ? ` · ${account.name}` : ""}
        </p>
      </div>
      <p className="text-sm font-bold font-mono tabular-nums text-slate-800 dark:text-slate-100 flex-shrink-0">
        −{fmt(amount)}
      </p>
    </div>
  );
}

// ── Inline sheet shell — visually identical to the production glass-sheet
// (rounded-3xl, drag handle, header row, solid surface, no backdrop-filter
// on the sheet itself per DESIGN.md's Glass Sheet rule) but laid out INLINE
// in the page flow rather than fixed-position-over-backdrop, so every step
// of a flow can sit in one scrollable review page instead of requiring a
// screenshot per overlay state. ──────────────────────────────────────────

export function InlineSheet({
  title,
  subtitle,
  onBack,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="glass-sheet rounded-3xl border border-slate-200/70 dark:border-white/[0.08] overflow-hidden">
      <div className="flex justify-center pt-3 pb-1">
        <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
      </div>
      <div className="flex items-center gap-3 px-5 pt-2 pb-3">
        {onBack ? (
          <button
            onClick={onBack}
            aria-label="Back"
            className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex-shrink-0 active:scale-95 transition-transform"
          >
            <ChevronLeft size={16} />
          </button>
        ) : null}
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</p>
          {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        <button
          aria-label="Close"
          className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex-shrink-0 active:scale-95 transition-transform"
        >
          <X size={14} />
        </button>
      </div>
      <div className="px-5 pb-5 space-y-3">{children}</div>
      {footer && <div className="px-5 pb-5 pt-1 space-y-2">{footer}</div>}
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
      {children}
    </label>
  );
}

export function TextField({
  value,
  placeholder,
  prefix,
}: {
  value: string;
  placeholder?: string;
  prefix?: string;
}) {
  return (
    <div className="relative">
      {prefix && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 text-sm pointer-events-none select-none">
          {prefix}
        </span>
      )}
      <div
        className={`w-full min-h-[48px] flex items-center ${prefix ? "pl-7" : "px-3"} pr-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent text-sm ${
          value ? "tabular-nums" : "text-slate-400 dark:text-slate-500"
        }`}
      >
        {value || placeholder}
      </div>
    </div>
  );
}

export function CheckDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex-shrink-0 w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center transition-colors ${
        selected ? "border-indigo-600 bg-indigo-600" : "border-slate-300 dark:border-slate-600"
      }`}
    >
      {selected && <span className="w-2 h-2 rounded-sm bg-white" />}
    </span>
  );
}

export function RadioDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex-shrink-0 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center transition-colors ${
        selected ? "border-indigo-600" : "border-slate-300 dark:border-slate-600"
      }`}
    >
      {selected && <span className="w-2 h-2 rounded-full bg-indigo-600" />}
    </span>
  );
}

export function AccountRow({ account, selected }: { account: Account; selected: boolean }) {
  const brand = accountBrand(account);
  return (
    <div className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5">
      <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText={brand.label} brandBg={brand.background} />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{account.name}</span>
        {account.provider && (
          <span className="block text-xs text-slate-400 dark:text-slate-500 truncate">{account.provider}</span>
        )}
      </span>
      <RadioDot selected={selected} />
    </div>
  );
}

export function SeriesRow({
  displayName,
  lastAmount,
  occurrences,
  selected,
}: {
  displayName: string;
  lastAmount: number;
  occurrences: number;
  selected: boolean;
}) {
  return (
    <div className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5">
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{displayName}</span>
        <span className="block text-xs text-slate-400 dark:text-slate-500 truncate">
          £{lastAmount.toFixed(2)} · {occurrences} {occurrences === 1 ? "time" : "times"} in 90 days
        </span>
      </span>
      <RadioDot selected={selected} />
    </div>
  );
}

// Two-option rhythm choice, "Every pay period" / "Just this period" — the
// envelope's recurrence (owner correction, 2026-08-29: an envelope isn't
// necessarily ongoing). Markup matches the shipped AllocationSheet.tsx
// "How often?" control exactly (grid-cols-2 bordered pills, not a
// segmented-track toggle) rather than a design-only invention, since the
// real recurrence picker landed on the live sheet while this round was in
// progress. Used inside an envelope shape's fields in Variant A and Variant
// B's derived step 3; Variant C folds the same choice into its top-level
// three-way shape toggle instead (see VariantC.tsx).
export function RhythmToggle({
  value,
  onChange,
}: {
  value: "every_period" | "once";
  onChange?: (v: "every_period" | "once") => void;
}) {
  return (
    <div>
      <div role="radiogroup" aria-label="How often?" className="grid grid-cols-2 gap-2">
        <button
          type="button"
          role="radio"
          aria-checked={value === "every_period"}
          onClick={() => onChange?.("every_period")}
          className={`min-h-[44px] px-3 rounded-xl border text-sm font-semibold transition-all active:scale-95 ${
            value === "every_period"
              ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
              : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
          }`}
        >
          Every pay period
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value === "once"}
          onClick={() => onChange?.("once")}
          className={`min-h-[44px] px-3 rounded-xl border text-sm font-semibold transition-all active:scale-95 ${
            value === "once"
              ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
              : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
          }`}
        >
          Just this period
        </button>
      </div>
      {value === "once" && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
          Applies to this pay period only, then it&apos;s done.
        </p>
      )}
    </div>
  );
}

export function PrimaryButton({ children }: { children: ReactNode }) {
  return (
    <div className="w-full min-h-[48px] rounded-xl bg-indigo-600 text-white text-sm font-semibold flex items-center justify-center gap-1.5">
      {children}
    </div>
  );
}

export function GhostAddDoor({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="w-full min-h-[44px] py-2 rounded-xl text-sm font-semibold text-indigo-600 dark:text-indigo-400 text-center">
      {label}
      {sub && <span className="block text-[11px] font-normal text-slate-400 dark:text-slate-500">{sub}</span>}
    </div>
  );
}

// ── Annotation panel — dashed-border design note, same idiom as the
// /design/dismissed entry-point round (EntryPointVariants.tsx's
// <Annotation/>), one dt/dd list per variant. ───────────────────────────

export function Annotation({
  variant,
  position,
  shapes,
  mapping,
  principle,
  doors,
  doorsLabel,
  extra,
}: {
  variant: "A" | "B" | "C";
  position: string;
  shapes: { label: string; flow: string }[];
  /** Owner correction, 2026-08-29: Variant B derives the shape from an
   * answer rather than showing it, so the annotation must show the mapping
   * explicitly (which plain-English answer resolves to which shape and
   * recurrence) since it is invisible everywhere else in the UI. */
  mapping?: { answer: string; resolvesTo: string }[];
  principle: string;
  doors: string;
  /** Defaults to "The three doors." for A/B; C overrides it, it only has two. */
  doorsLabel?: string;
  /** Free-form extra dt/dd entries appended after "doors" — used by Variant
   * C to re-argue whether the one-off door still stands now that an
   * envelope can also be "just once". */
  extra?: { label: string; text: string }[];
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 px-4 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
        Design note, variant {variant}
      </p>
      <dl className="space-y-1.5 text-[12px] leading-snug">
        <div>
          <dt className="inline font-semibold text-slate-600 dark:text-slate-300">Position. </dt>
          <dd className="inline text-slate-500 dark:text-slate-400">{position}</dd>
        </div>
        {shapes.map((s) => (
          <div key={s.label}>
            <dt className="inline font-semibold text-slate-600 dark:text-slate-300">{s.label}. </dt>
            <dd className="inline text-slate-500 dark:text-slate-400">{s.flow}</dd>
          </div>
        ))}
        {mapping && mapping.length > 0 && (
          <div>
            <dt className="font-semibold text-slate-600 dark:text-slate-300">Answer to shape mapping.</dt>
            <dd>
              <ul className="mt-1 space-y-1">
                {mapping.map((m) => (
                  <li key={m.answer} className="text-slate-500 dark:text-slate-400">
                    <span className="text-slate-700 dark:text-slate-200">&quot;{m.answer}&quot;</span> resolves to {m.resolvesTo}.
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        <div>
          <dt className="inline font-semibold text-slate-600 dark:text-slate-300">Skill principle. </dt>
          <dd className="inline text-slate-500 dark:text-slate-400">{principle}</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-slate-600 dark:text-slate-300">{doorsLabel ?? "The three doors."} </dt>
          <dd className="inline text-slate-500 dark:text-slate-400">{doors}</dd>
        </div>
        {extra?.map((e) => (
          <div key={e.label}>
            <dt className="inline font-semibold text-slate-600 dark:text-slate-300">{e.label}. </dt>
            <dd className="inline text-slate-500 dark:text-slate-400">{e.text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function StepDots({ count, active }: { count: number; active: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5 pb-1" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 rounded-full transition-all ${
            i === active ? "w-4 bg-indigo-500" : "w-1.5 bg-slate-300 dark:bg-slate-600"
          }`}
        />
      ))}
    </div>
  );
}

export function NextRow({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-between">{children}</div>;
}

export { ChevronRight };
