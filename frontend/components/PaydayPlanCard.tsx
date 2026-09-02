"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { X } from "lucide-react";
import type { CompanionItem, PaydayPlanDest } from "@/lib/api";
import { api } from "@/lib/api";
import { BankBadge, BANK_META, bankKey } from "@/components/AccountMiniCard";
import PennyMark from "@/components/PennyMark";
import MoneyText from "@/components/MoneyText";

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
  /**
   * Permanent dismiss (writes to the backend via api.dismissTodayItem and
   * hides the plan locally until the server regenerates it). Home-only —
   * Penny is the plan's permanent home (owner rule, 2026-08-29) and must
   * never offer this. Ignored whenever `onClose` is provided: that case is
   * always a plain, non-persisting collapse (used by the entry-row preview
   * toggle and the executed-row expand on BOTH surfaces), never a dismiss.
   * Defaults to false — a caller must opt in explicitly, so a forgotten
   * prop fails closed (no X) rather than open.
   */
  dismissible?: boolean;
}

// Multi-destination fork of MoveCard — one payday_plan item can fan money out
// to several destination accounts, each with its own sources. Reuses MoveCard's
// visual language throughout: Penny gradient chip, glass-tile dest/ledger rows,
// BankBadge/resolveBankChip logos, £ formatting + hideNetWorth masking, and the
// same indigo action-button styling. Dismiss mirrors CelebrationCard/CliffCard
// (self-contained: local `hidden` state + a direct api.dismissTodayItem call —
// HomeBrief does not thread an onDismiss prop through any companion card).
export default function PaydayPlanCard({ item, router, hideNetWorth, maskAmounts, onClose, dismissible = false }: PaydayPlanCardProps) {
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

  // Bug fix (2026-08-29, owner report): this used to branch on `item.preview`
  // to decide collapse-vs-dismiss, which was wrong — the executed-row expand
  // (HomeBrief.tsx's ExecutedPaydayRow) passes `onClose` but `item.preview`
  // is false there, so the X fell into `handleDismiss` instead of collapsing:
  // clicking it looked like the whole "already split" report vanished
  // (`setHidden(true)`), AND silently persisted a dismiss server-side, which
  // is why it "cleared but came back on refresh" (a fresh /today re-fetch
  // remounts this component with `hidden` back at its default `false`, while
  // the persisted dismiss doesn't even suppress the executed item's
  // regeneration path in companion.py). The fix: branch on whether `onClose`
  // was passed, not on the item's own preview flag — `onClose` always means
  // "this is a collapsible view, closing it just collapses", regardless of
  // preview/live/executed state.
  const showCloseButton = !!onClose || dismissible;

  function handleCloseClick(e: React.MouseEvent) {
    if (onClose) {
      e.stopPropagation();
      onClose();
      return;
    }
    handleDismiss(e);
  }

  // No glow/ring here (owner, 2026-08-29): the "payday" rung was removed
  // outright from lib/attention.ts — this card is a large, full-bleed
  // Penny-branded surface (gradient chip, hero £ figure) and is already
  // its own attention; a halo on top of that reads as decoration, not
  // signal. Plain glass-card in every state (live, preview, ask).
  return (
    <div className="glass-card rounded-2xl p-4">
      {/* Penny gradient chip — marks this as a proactive advice surface, same
          treatment as MoveCard/AskPaydayCard/AskGenericCard. Close/dismiss
          sits on the same row, gated by `showCloseButton` (see above): a
          collapse-only × whenever `onClose` is passed (preview toggle,
          executed-row expand — never persists, safe on both Home and
          Penny), or a real dismiss × only when the caller opts in via
          `dismissible` (Home's live, not-yet-executed full card — see
          HomeBrief.tsx's PaydayPlanSection, `dismissible={!!gate}`). Penny
          never sets `dismissible`, so its live card renders no × at all
          (owner rule 2026-08-29: Penny is the plan's permanent home, only
          Home may dismiss it). Dismiss × is the V2 "Glass chip" (owner
          decision, Kevin 2026-08-27, /design/dismiss-x), the one dismiss-x
          treatment for cards app-wide; see HomeBrief.tsx's DismissChip for
          the canonical (factored) version — this card lives outside
          HomeBrief.tsx so it carries its own copy of the same markup
          rather than importing an unexported local component. */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <span
          className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1"
          style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
        >
          <PennyMark size={11} />
          Penny
        </span>
        {showCloseButton && (
          <button
            type="button"
            aria-label={onClose ? "Close" : "Dismiss"}
            onClick={handleCloseClick}
            className="flex-shrink-0 -mt-2 -mr-2 w-11 h-11 flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-95 transition-transform duration-150"
          >
            <span className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-900/[0.05] dark:bg-white/[0.06] border border-slate-900/[0.06] dark:border-white/10 [@media(hover:hover)]:hover:bg-slate-900/[0.09] dark:[@media(hover:hover)]:hover:bg-white/[0.11] transition-colors duration-150">
              <X size={14} aria-hidden="true" className="text-slate-500 dark:text-slate-300" />
            </span>
          </button>
        )}
      </div>

      {/* Preview framing — Penny-voice sentence stating this is hypothetical,
          so the card can't be mistaken for a live instruction. Dated + hedged
          to the REAL next payday (2026-08-29 FIX B) rather than the old "if
          your pay landed today" framing, which priced a fictional same-day
          credit. Falls back to the old copy only if `next_pay` is somehow
          missing (should not happen once the plan is computed server-side). */}
      {item.preview && (
        <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-snug mb-2">
          {item.next_pay
            ? `Once your pay lands ~${new Date(item.next_pay).toLocaleDateString("en-GB", {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}, here's how I'd split it.`
            : "Once your pay lands, here's how I'd split it."}
        </p>
      )}

      {/* Hero figure — ONE number the eye lands on: total moving out, with a
          whispered "moving to N accounts" label. Replaces the old buried
          mid-headline amount + 12px footer total. Guarded to the same
          condition the old footer total used, so the isSet ("you're set for
          the month") variant keeps its calm headline/body ramp with no hero. */}
      {(item.total ?? 0) > 0 && (
        <div className="mb-3">
          <p className="money text-[28px] font-bold tracking-tight text-slate-900 dark:text-slate-100">
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
          <MoneyText text={maskAmounts(item.body)} />
        </p>
      )}

      {/* Trimmed notice — amber (not red): buffers were reduced to make the
          plan fit this month, informational not alarming. */}
      {item.trimmed && (
        <p className="flex items-start gap-1.5 text-[12px] text-slate-500 dark:text-slate-400 leading-snug mb-3">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[3px] bg-amber-500" aria-hidden="true" />
          <span>Buffers trimmed to fit this month.</span>
        </p>
      )}

      {/* Payday split — quiet visibility line for items scheduled ON payday
          itself (2026-08-28 decision): they no longer count in this
          period's arithmetic anywhere, but stay visible here as a distinct
          slice. Purely informational, not a verdict, so it gets the same
          quiet ramp as the "Already set" summary line below rather than a
          tile or a colour treatment — it must not compete with the hero
          figure above, which is still this period's total. Incoming pay is
          hedged with ~ since it hasn't landed yet; the outgoing split total
          is a scheduled fact, not hedged. */}
      {item.payday_split && (
        <p className="text-[12px] text-slate-400 dark:text-slate-500 leading-snug mb-3">
          <MoneyText
            text={maskAmounts(
              `Payday split: £${Math.round(item.payday_split.total).toLocaleString("en-GB")} across ${item.payday_split.count} ${
                item.payday_split.count === 1 ? "move" : "moves"
              }, funded by your ~£${Math.round(item.payday_split.expected_in).toLocaleString("en-GB")} expected pay.`
            )}
          />
        </p>
      )}

      {/* Payday split risk — restrained amber warning row, same signifier
          language as the trimmed notice above (amber dot, normal ink text,
          no red/amber-flooded background): this is a TIMING risk (salary
          landing late), not a genuine loss, per DESIGN.md's Red Is Risk
          Rule. `copy` arrives pre-written and hedged server-side; rendered
          verbatim (through the same maskAmounts/MoneyText treatment every
          other server-authored sentence on this card gets) rather than
          re-derived here. */}
      {item.payday_split_risk && (
        <p className="flex items-start gap-1.5 text-[12px] text-slate-500 dark:text-slate-400 leading-snug mb-3">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[3px] bg-amber-500" aria-hidden="true" />
          <span><MoneyText text={maskAmounts(item.payday_split_risk.copy)} /></span>
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
            <span className="money text-sm font-bold text-emerald-600 dark:text-emerald-400 flex-shrink-0">
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
                  <span className="money text-sm font-semibold text-slate-900 dark:text-slate-100 flex-shrink-0">
                    {hideNetWorth ? "£••••" : `£${Math.round(dest.move).toLocaleString("en-GB")}`}
                  </span>
                </div>
                {breakdownParts.length > 0 && (
                  <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 leading-snug pl-[46px]">
                    <MoneyText text={maskAmounts(breakdownParts.join(" · "))} />
                  </p>
                )}
                {showUsual && (
                  <p className="mt-0.5 text-[12px] text-slate-400 dark:text-slate-500 leading-snug pl-[46px]">
                    <MoneyText text={maskAmounts(`you usually send £${Math.round(dest.usual!).toLocaleString("en-GB")}`)} />
                  </p>
                )}
                {/* Commitment sub-line — same quiet ramp as the "usual"
                    line above, answering "why is this leg here" for a move
                    that's floored by an active goal slice rather than the
                    account's own bills/spend/buffer sizing (2026-08-29 FIX
                    C: previously an unexplained leg, e.g. £500 to Saving
                    Challenge with no stated reason). */}
                {dest.commitment_names && dest.commitment_names.length > 0 && (
                  <p className="mt-0.5 text-[12px] text-slate-400 dark:text-slate-500 leading-snug pl-[46px]">
                    {`funds ${dest.commitment_names[0]}${
                      dest.commitment_names.length > 1 ? ` +${dest.commitment_names.length - 1} more` : ""
                    }`}
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
          <MoneyText text={maskAmounts(`£${Math.round(item.salary.stays).toLocaleString("en-GB")} stays with you in ${item.salary.name}.`)} />
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
