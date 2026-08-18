"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { X } from "lucide-react";
import type { CompanionItem, PaydayPlanDest } from "@/lib/api";
import { api } from "@/lib/api";
import { BankBadge, BANK_META, bankKey } from "@/components/AccountMiniCard";
import PennyMark from "@/components/PennyMark";

// Same resolver MoveCard uses in HomeBrief.tsx — kept local (not exported from
// there) so this component doesn't reach into HomeBrief's module internals.
function resolveBankChip(provider: string) {
  const key = bankKey({ provider });
  const meta = BANK_META[key];
  return {
    logoSrc: meta?.logoFile
      ? `/banks/${meta.logoFile}`
      : meta?.domain
      ? `https://www.google.com/s2/favicons?domain=${meta.domain}&sz=64`
      : null,
    initials: meta?.initials ?? (provider || "?").slice(0, 2).toUpperCase(),
    label: meta?.label ?? (provider || "Bank"),
    bg: meta?.bg,
    initialsSize: meta?.initialsSize,
  };
}

interface PaydayPlanCardProps {
  item: CompanionItem;
  router: ReturnType<typeof useRouter>;
  hideNetWorth: boolean;
  maskAmounts: (text: string) => string;
  onRefresh?: () => void;
  onClose?: () => void;
  /** Glow this card — true only when the attention resolver targets "payday". */
  glow?: boolean;
}

// Multi-destination fork of MoveCard — one payday_plan item can fan money out
// to several destination accounts, each with its own sources. Reuses MoveCard's
// visual language throughout: Penny gradient chip, glass-tile dest/ledger rows,
// BankBadge/resolveBankChip logos, £ formatting + hideNetWorth masking, and the
// same indigo action-button styling. Dismiss mirrors CelebrationCard/CliffCard
// (self-contained: local `hidden` state + a direct api.dismissTodayItem call —
// HomeBrief does not thread an onDismiss prop through any companion card).
export default function PaydayPlanCard({ item, router, hideNetWorth, maskAmounts, onClose, glow }: PaydayPlanCardProps) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  const dests: PaydayPlanDest[] = item.dests ?? [];
  const isSet = dests.length === 0; // "you're set for the month" variant — calm reassurance, no tiles
  const destsWithMove = dests.filter((d) => d.move > 0).sort((a, b) => b.move - a.move);
  const destsSettled = dests.filter((d) => d.move === 0 && d.usual != null);
  const moveCount = destsWithMove.length;

  // Headline prose duplicates the hero figure ("split £4,798 across N
  // accounts") — strip the amount client-side now that the total has its own
  // hero treatment below. Regex has no match on headlines without a £ figure,
  // so it safely falls back to the raw headline in that case.
  const headlineNoAmount = item.headline.replace(/£[\d,]+ ?/g, "");

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    setHidden(true);
    api.dismissTodayItem(item.id).catch(() => {
      /* card already removed locally; the backend will re-surface next run */
    });
  }

  return (
    <div className={`glass-card rounded-2xl p-4${glow ? " needs-you" : ""}`}>
      {/* Penny gradient chip — marks this as a proactive advice surface, same
          treatment as MoveCard/AskPaydayCard/AskGenericCard. Close/dismiss
          sits on the same row, matching the CelebrationCard/CliffCard
          top-right X sizing (44px hit target) — shown in both real and
          preview mode now (preview closes locally via onClose). */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <span
          className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1"
          style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
        >
          <PennyMark size={11} />
          Penny
        </span>
        <button
          type="button"
          aria-label={item.preview ? "Close preview" : "Dismiss"}
          onClick={item.preview ? () => onClose?.() : handleDismiss}
          className="flex-shrink-0 -mt-2 -mr-2 w-11 h-11 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 active:scale-95 transition-[transform,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {/* Preview framing — Penny-voice sentence stating this is hypothetical,
          so the card can't be mistaken for a live instruction. */}
      {item.preview && (
        <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-snug mb-2">
          If your pay landed today, here&apos;s how I&apos;d split it.
        </p>
      )}

      {/* Hero figure — ONE number the eye lands on: total moving out, with a
          whispered "moving to N accounts" label. Replaces the old buried
          mid-headline amount + 12px footer total. Guarded to the same
          condition the old footer total used, so the isSet ("you're set for
          the month") variant keeps its calm headline/body ramp with no hero. */}
      {(item.total ?? 0) > 0 && (
        <div className="mb-3">
          <p className="num text-[28px] font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {hideNetWorth ? "£••••" : `£${Math.round(item.total ?? 0).toLocaleString("en-GB")}`}
          </p>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mt-0.5">
            Moving to {moveCount} {moveCount === 1 ? "account" : "accounts"}
          </p>
        </div>
      )}

      {/* Headline — amount stripped (see headlineNoAmount above); the hero
          figure now carries that number. */}
      <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose">
        <strong className="text-slate-900 dark:text-slate-100 font-semibold">{headlineNoAmount}</strong>
      </p>

      {/* Body sentence */}
      {item.body && (
        <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose">
          {maskAmounts(item.body)}
        </p>
      )}

      {/* Trimmed notice — amber (not red): buffers were reduced to make the
          plan fit this month, informational not alarming. */}
      {item.trimmed && (
        <p className="text-[12px] text-amber-600 dark:text-amber-400 leading-snug mb-3">
          Buffers trimmed to fit this month.
        </p>
      )}

      {/* Salary tile — the FROM account for every allocation below. Right side
          uses the codebase's existing "credit amount" convention (see
          TransactionSheet.tsx: "+" prefix, emerald, bold) since this is money
          landing, not leaving. */}
      {item.salary && (
        <div className="glass-tile rounded-xl px-3 py-2.5 mb-3">
          <div className="flex items-center gap-2.5">
            <span className="flex-shrink-0">
              <BankBadge
                logoSrc={resolveBankChip(item.salary.provider ?? "").logoSrc}
                initials={resolveBankChip(item.salary.provider ?? "").initials}
                initialsSize={resolveBankChip(item.salary.provider ?? "").initialsSize}
                altText={resolveBankChip(item.salary.provider ?? "").label}
                brandBg={resolveBankChip(item.salary.provider ?? "").bg}
              />
            </span>
            <span className="flex-1 min-w-0">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate block">
                {item.salary.name}
              </span>
            </span>
            <span className="num text-sm font-bold text-emerald-600 dark:text-emerald-400 flex-shrink-0">
              {hideNetWorth ? "£••••" : `~£${Math.round(item.salary.amount).toLocaleString("en-GB")}`}
            </span>
          </div>
          <p className="mt-1 text-[12px] text-slate-400 dark:text-slate-500 leading-snug pl-[46px]">
            expected
          </p>
        </div>
      )}

      {/* Destination rows — one allocation per dest FROM the salary account
          above, sorted by move size. Skipped entirely for the "you're set"
          variant: no tiles, just the headline/body ramp (calm reassurance,
          not a celebration). */}
      {!isSet && (
        <div className="space-y-2">
          {destsWithMove.map((dest, di) => {
            const destChip = resolveBankChip(dest.provider ?? "");
            const breakdownParts: string[] = [];
            if (dest.bills_total > 0) {
              breakdownParts.push(`£${Math.round(dest.bills_total).toLocaleString("en-GB")} payments`);
            }
            if (dest.spend_typical > 0) {
              breakdownParts.push(`~£${Math.round(dest.spend_typical).toLocaleString("en-GB")} spending`);
            }
            if (dest.buffer > 0) {
              breakdownParts.push(`£${Math.round(dest.buffer).toLocaleString("en-GB")} buffer`);
            }
            const showUsual = dest.usual != null && Math.abs(dest.usual - dest.move) > 25;
            return (
              <div key={dest.account_id ?? di} className="glass-tile rounded-xl px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="flex-shrink-0">
                    <BankBadge
                      logoSrc={destChip.logoSrc}
                      initials={destChip.initials}
                      initialsSize={destChip.initialsSize}
                      altText={destChip.label}
                      brandBg={destChip.bg}
                    />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate block">
                      {dest.name}
                    </span>
                  </span>
                  <span className="num text-sm font-semibold text-slate-900 dark:text-slate-100 flex-shrink-0">
                    {hideNetWorth ? "£••••" : `£${Math.round(dest.move).toLocaleString("en-GB")}`}
                  </span>
                </div>
                {breakdownParts.length > 0 && (
                  <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 leading-snug pl-[46px]">
                    {maskAmounts(breakdownParts.join(" · "))}
                  </p>
                )}
                {showUsual && (
                  <p className="mt-0.5 text-[12px] text-slate-400 dark:text-slate-500 leading-snug pl-[46px]">
                    {maskAmounts(`you usually send £${Math.round(dest.usual!).toLocaleString("en-GB")}`)}
                  </p>
                )}
              </div>
            );
          })}

          {/* Collapsed summary for dests already at target this month
              (move === 0 but there's a known usual amount) — one quiet line,
              no tile, no judgement styling. */}
          {destsSettled.length > 0 && (
            <p className="text-[12px] text-slate-400 dark:text-slate-500 leading-snug">
              {maskAmounts(`Already set: ${destsSettled.map((d) => d.name).join(", ")}`)}
            </p>
          )}
        </div>
      )}

      {/* Arc close — the remainder line that used to be an embedded "stays
          here" whisper inside the salary tile now closes the in → out →
          remainder story after the dest tiles, so no arithmetic is left to
          the reader. */}
      {item.salary && item.salary.stays > 0 && (
        <p className="mt-3 text-[13px] text-slate-600 dark:text-slate-300 leading-snug">
          {maskAmounts(`£${Math.round(item.salary.stays).toLocaleString("en-GB")} stays with you in ${item.salary.name}.`)}
        </p>
      )}

      {/* Footer — action button only; the hero figure above replaced the old
          12px total line, so the footer no longer needs to restate it. */}
      {item.action && (
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button
            onClick={() => router.push(item.action!.route)}
            className="inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-[transform,background-color] text-white text-sm font-semibold px-4 py-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {item.preview ? "See the full plan ›" : item.action.label}
          </button>
        </div>
      )}
    </div>
  );
}
