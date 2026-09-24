import type { ReactNode } from "react";
import { WalletCards } from "lucide-react";
import type { PaydayPlanDest } from "@/lib/api";
import { BANK_META, BankBadge, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import PennyMark from "@/components/PennyMark";

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

// Same resolver PaydayPlanCard.tsx uses (local copy, matching convention
// carried over from payday-plan-grammar's own shared.tsx bankMeta helper).
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

export function AccountChip({ account, size = 32 }: { account: { name: string; provider: string }; size?: number }) {
  const chip = resolveBankChip(account.provider);
  return (
    <span className="flex-shrink-0" data-account-badge={account.provider}>
      <BankBadge logoSrc={chip.logoSrc} initials={chip.initials} initialsSize={chip.initialsSize} altText={chip.label} brandBg={chip.bg} size={size} />
    </span>
  );
}

export function CardShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="p-4">
        <div className="mb-3 flex items-start gap-3">
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
        {children}
      </div>
    </article>
  );
}

export function SectionHeading({ title, subtotal, subtotalLabel }: { title: string; subtotal?: number; subtotalLabel?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">{title}</h3>
      {subtotal !== undefined && (
        <p className="shrink-0 text-right">
          <Currency value={subtotal} className="text-[13px] font-bold text-slate-900 dark:text-slate-100" />
          {subtotalLabel && <span className="ml-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">{subtotalLabel}</span>}
        </p>
      )}
    </div>
  );
}

function breakdownParts(dest: PaydayPlanDest): string[] {
  const parts: string[] = [];
  if (dest.bills_total > 0) parts.push(`£${Math.round(dest.bills_total).toLocaleString("en-GB")} payments`);
  if (dest.spend_typical > 0) parts.push(`~£${Math.round(dest.spend_typical).toLocaleString("en-GB")} spending`);
  if (dest.buffer > 0) parts.push(`£${Math.round(dest.buffer).toLocaleString("en-GB")} buffer`);
  return parts;
}

/** True for the savings-pot habitual top-up shape: nothing owed (target 0)
 * but a habitual amount still moves. Framed as a top-up, never as a
 * needs/has/moving shortfall (G128 fact 2: a savings top-up is not a gap).
 *
 * FRAGILE HEURISTIC, read before touching this function: `target === 0` is
 * a provisional stand-in, not a real "this is a savings top-up" signal. It
 * only happens to identify Kevin's Personal GBP savings destination in the
 * fixture correctly because of a backend defect, filed as G129: the
 * trimmed-month re-derive block in backend/app/services/companion.py
 * (around line 2816) recomputes `target` for every destination, including
 * savings ones, using the non-savings formula (bills_total + spend_typical
 * + buffer). A savings destination has none of those three inputs, so its
 * target happens to come out as 0, which is what this check keys off.
 * Once G129 is fixed, this destination's target would become 100 (its real
 * need), it would fall through to the normal branch instead, and it would
 * render "Needs £100 · has £100 · moving £100": still correct-looking, but
 * arrived at by accident, since target === 0 would stop being true even
 * though the row is still, semantically, a habitual top-up. The durable
 * fix is an explicit savings/top-up flag supplied by the backend on the
 * destination object, not a target-equals-zero inference. Update this
 * check when G129 lands, or this row will misrender silently. */
function isHabitualTopUp(dest: PaydayPlanDest): boolean {
  return dest.target === 0 && dest.move > 0;
}

/**
 * One destination row in the needs / has / moving grammar (G128 fix): the
 * subline states plainly what each figure answers instead of leaving the
 * reader to subtract balance from target themselves. `showBreakdown` keeps
 * the payments/spending/buffer composition (Variant B); Variant A drops it
 * for brevity, per the brief.
 */
export function DestinationRow({ dest, showBreakdown = false }: { dest: PaydayPlanDest; showBreakdown?: boolean }) {
  const topUp = isHabitualTopUp(dest);
  const parts = breakdownParts(dest);
  return (
    <div data-destination-row data-destination-move={dest.move} className="flex min-h-12 items-start gap-2.5 py-2">
      <AccountChip account={dest} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-slate-900 dark:text-white">{dest.name}</p>
        {showBreakdown && parts.length > 0 && (
          <p className="truncate text-[11px] leading-4 text-slate-500 dark:text-slate-400">{parts.join(" · ")}</p>
        )}
        {topUp ? (
          <p className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">Usual top-up to this pot, not a shortfall to cover</p>
        ) : (
          <p className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">
            Needs <Currency value={dest.target} /> · has <Currency value={dest.balance} />
          </p>
        )}
      </div>
      <Currency value={dest.move} className="shrink-0 pt-0.5 text-[13px] font-semibold text-slate-950 dark:text-white" />
    </div>
  );
}

/** Settled accounts, shown WITH an amount (G128 fact 2: bare names alone
 * read as "the app forgot to say how much"). Never presented as reconciling
 * with any other total on the card. */
export function SettledGroup({ dests }: { dests: readonly PaydayPlanDest[] }) {
  if (dests.length === 0) return null;
  const usualTotal = dests.reduce((sum, d) => sum + (d.usual ?? 0), 0);
  return (
    <div data-settled-group className="mt-2 rounded-xl bg-slate-50/70 px-3 py-2.5 dark:bg-slate-900/30">
      <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">
        {dests.length} {dests.length === 1 ? "account needs" : "accounts need"} nothing this period
      </p>
      <ul className="mt-1.5 space-y-1">
        {dests.map((dest) => (
          <li key={dest.account_id} className="flex items-center gap-2 text-[12px] text-slate-500 dark:text-slate-400">
            <AccountChip account={dest} size={20} />
            <span className="min-w-0 flex-1 truncate">{dest.name} · {resolveBankChip(dest.provider).label}</span>
            {dest.usual != null && <Currency value={dest.usual} prefix="usually " className="shrink-0 text-slate-400 dark:text-slate-500" />}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
        Usually <Currency value={usualTotal} className="text-slate-400 dark:text-slate-500" /> combined when topped up. £0 needed now.
      </p>
    </div>
  );
}

export function TrimmedNotice() {
  return (
    <p className="flex items-start gap-1.5 text-[12px] text-slate-500 dark:text-slate-400 leading-snug">
      <span className="mt-[3px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
      <span>A tight month: buffers and spending allowances were both trimmed to fit this period.</span>
    </p>
  );
}

export function RoundingNote() {
  return (
    <p className="text-[11px] text-slate-400 dark:text-slate-500">
      Amounts round up to the nearest £5, so a moving figure can be a few pounds more than needs minus has.
    </p>
  );
}

export type PaydaySplitInfo = NonNullable<import("@/lib/api").CompanionItem["payday_split"]>;
export type PaydaySplitRiskInfo = NonNullable<import("@/lib/api").CompanionItem["payday_split_risk"]>;

/** The relabelled payday-split line (G128 fact 1 and 2): different nouns
 * from the moving total above ("bill payments" leaving an account, not
 * "moves" to an account), and an explicit statement that this is a
 * separate figure, never implying it reconciles with the total above. */
export function PaydaySplitLine({ split, movingTotal }: { split: PaydaySplitInfo; movingTotal: number }) {
  return (
    <p className="text-[12px] leading-5 text-slate-500 dark:text-slate-400">
      Separate from the <Currency value={movingTotal} className="text-slate-500 dark:text-slate-400" /> above:{" "}
      {split.count} bill {split.count === 1 ? "payment" : "payments"} totalling <Currency value={split.total} className="text-slate-500 dark:text-slate-400" />{" "}
      leave {split.accounts[0]?.name ?? "your salary account"} on payday itself, expected to be covered by your{" "}
      <Currency value={split.expected_in} prefix="~" className="text-slate-500 dark:text-slate-400" /> pay landing the same morning.
    </p>
  );
}

/** Timing-risk row: amber (a timing risk, never red per DESIGN.md), and
 * states the shortfall the backend already computed rather than repeating
 * the bill total a third time (G128 fact 1). */
export function PaydaySplitRiskLine({ risk }: { risk: PaydaySplitRiskInfo }) {
  return (
    <p className="flex items-start gap-1.5 text-[12px] text-slate-500 dark:text-slate-400 leading-snug">
      <span className="mt-[3px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
      <span>
        Timing risk: if your pay lands after this bill run, {risk.name} is projected about{" "}
        <Currency value={risk.shortfall} className="text-slate-500 dark:text-slate-400" /> short that morning, until your pay clears.
      </span>
    </p>
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
