"use client";

// Shared ledger-row primitive for the accounts-estate redesign. Renders one
// normalized EstateRow (bank account OR investment) — adapted from the
// approved design preview's `AccountLedgerRow` in
// app/design/accounts-rows/page.tsx, but consuming real data via EstateRow
// instead of the preview's MockAccount fixture.
//
// Rendered across AccountsPage and HomePage.

import { Star } from "lucide-react";
import { BankBadge, accountBrand, type TermsPill } from "./AccountMiniCard";
import { accountKindLabel } from "@/lib/accountKind";
import type { EstateRow } from "@/lib/accountsEstate";
import type { Account } from "@wealth/shared";
import { SyncGlyph, asOfLabel, syncBank, syncPhase, type SyncingInfo } from "./SyncNote";

function moneyStr(n: number): string {
  return `£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
}

// Unicode minus (U+2212), matching MoneyText's CURRENCY_TOKEN regex and
// AccountsPage's net-worth rendering — never a plain hyphen.
const MINUS = "−";

// ── Inline sparkline (investment rows) — 52x20, low-opacity indigo stroke,
// a whisper of trend, not a chart. Matches the approved preview exactly. ──

function sparklinePoints(series: number[], w: number, h: number): string {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  return series
    .map((v, i) => {
      const x = (i / Math.max(1, series.length - 1)) * w;
      const y = h - 2 - ((v - min) / range) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function MiniSparkline({ series }: { series: number[] }) {
  return (
    <svg width={52} height={20} viewBox="0 0 52 20" aria-hidden="true" className="block shrink-0">
      <polyline
        points={sparklinePoints(series, 52, 20)}
        fill="none"
        stroke="rgba(129,140,248,0.55)"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Utilisation bar (credit rows) — calm rose fill on a faint track;
// deepens toward rose at high utilisation, no alarm theatre (Red Is Risk
// still holds). Off by default — no live limit data exists yet. ──────────

function UtilisationBar({ pct, limit }: { pct: number; limit: number }) {
  const clamped = Math.min(100, Math.max(0, Math.round(pct)));
  const heavy = clamped >= 80;
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="h-1 flex-1 min-w-0 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none ${
            heavy ? "bg-rose-400/90" : "bg-rose-400/55"
          }`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="shrink-0 text-[10px] text-slate-500 dark:text-slate-400 num">
        {clamped}% of <span className="font-mono tabular-nums">£{limit.toLocaleString("en-GB")}</span>
      </span>
    </div>
  );
}

/** Investment rows have no full `Account` record to brand against —
 *  accountBrand()/bankKey() only read provider/provider_id/bg_colors/logo_url,
 *  so a minimal stand-in resolves the provider chip correctly without a real
 *  bank account underneath. */
function brandAccountFor(row: EstateRow): Account {
  if (row.source === "bank") return row.raw as Account;
  return {
    id: row.id,
    name: row.name,
    type: row.kind,
    balance: row.balance,
    currency: "GBP",
    provider: row.provider,
    status: row.status,
  };
}

export interface AccountLedgerRowProps {
  row: EstateRow;
  pinned?: boolean;
  onClick?: (row: EstateRow) => void;
  /** Utilisation bar is OFF by default — no live credit-limit data source
   *  exists yet. Only pass `utilisation` once one does. */
  showUtilisation?: boolean;
  utilisation?: { pct: number; limit: number };
  /** Sparkline is OFF by default — no per-account balance-history series
   *  exists yet. Only pass this once one does. */
  sparkline?: number[];
  /** Confirmed card-terms pill (credit rows) — mirrors AccountMiniCard's
   *  termsPill/onTermsClick/onAddRates trio so the "manage this card's
   *  rates" entry point survives the ledger-rows redesign. */
  termsPill?: TermsPill | null;
  onTermsClick?: () => void;
  onAddRates?: () => void;
  /** G214 (approved B): this row's bank is syncing. The balance stays, in
   *  neutral ink, with the ring beside it and when it was last good; a bank
   *  that has never synced reads "Pending", never £0. Absent, the row renders
   *  exactly as before. Retry lives on the page-level banner, so the row
   *  never grows a second interactive control. */
  sync?: SyncingInfo;
  /** G236: mask the balance (and its spoken form) when the user has chosen to
   *  hide balances. Absent, the row renders exactly as before. */
  hideAmount?: boolean;
}

export default function AccountLedgerRow({
  row,
  pinned,
  onClick,
  showUtilisation,
  utilisation,
  sparkline,
  termsPill,
  onTermsClick,
  onAddRates,
  sync,
  hideAmount,
}: AccountLedgerRowProps) {
  const brand = accountBrand(brandAccountFor(row));
  const isCredit = row.kind === "Credit";
  const isInvestment = row.kind === "Investment";
  const muted = row.dormant;
  const isPinned = pinned ?? row.pinned;
  // G231: a bank account the user does not count towards Safe to Spend. The
  // balance still shows; only a quiet slate tag says it is not counted.
  const notCounted = row.source === "bank" && (row.raw as Account).include_in_safe_to_spend === false;

  // Direction of money, not just account kind — an overdrawn current/savings
  // account is genuine risk (Red Is Risk), a credit card in credit is not
  // debt at all. isDormant only ever matches balance === 0, so a negative
  // balance is never also muted.
  const isOverdrawn = !isCredit && row.balance < 0;
  const isOwedOnCredit = isCredit && row.balance < 0;
  const isCreditInCredit = isCredit && row.balance > 0;
  const negative = row.balance < 0;
  // Minus sign now carries the direction for every negative balance,
  // credit cards included — Variant B drops the "owed" caption stack, so
  // the sign has to do that job on its own (matches design/account-rows
  // shared.tsx's amountText). Non-credit output is unchanged: isOverdrawn
  // and `negative` are equivalent there.
  const amountText = hideAmount ? "£••••" : negative ? `${MINUS}${moneyStr(row.balance)}` : moneyStr(row.balance);
  // Spoken/aria state word — unchanged from before the redesign, so screen
  // readers still hear "owed" / "in credit" / "overdrawn" even though the
  // visual caption below only survives for non-credit rows.
  const stateCaption = isOwedOnCredit ? "owed" : isCreditInCredit ? "in credit" : isOverdrawn ? "overdrawn" : null;
  // Red is earned (Variant B): a credit balance only renders rose when the
  // card is genuinely accruing interest right now — a confirmed standard
  // APR with no active 0% promo covering today (termsPillFor sets
  // accruing:true only in that case). Every 0%-covered balance, and any
  // card with no recorded terms at all, stays ink.
  const isCreditAccruing = isCredit && negative && !!termsPill?.accruing;
  // G214: a syncing balance is stale, so it never wears a risk colour.
  const syncPhaseNow = sync ? syncPhase(sync) : null;
  const syncAsOf = sync ? asOfLabel(sync.asOf) : null;
  const syncBankName = sync ? syncBank(sync) : "";
  const syncRowLine = sync
    ? syncPhaseNow === "failed"
      ? "Could not update"
      : syncPhaseNow === "stalled"
        ? "Taking longer than usual"
        : sync.kind === "new-bank"
          ? `Fetching from ${syncBankName}`
          : `Updating from ${syncBankName}`
    : null;
  const syncWord = syncPhaseNow === "failed" ? "Not updated" : syncPhaseNow === "stalled" ? "Delayed" : "Updating";
  // A bank that has never synced has no balance to keep: say so, never £0.
  const balancePending = sync?.kind === "new-bank";
  const amountToneClass = sync
    ? balancePending
      ? "!text-[13px] font-medium text-slate-600 dark:text-slate-300"
      : "text-slate-700 dark:text-slate-200"
    : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick ? () => onClick(row) : undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.(row);
        }
      }}
      aria-label={`${row.name}, ${balancePending ? "balance not available yet" : hideAmount ? "balance hidden" : moneyStr(row.balance)}${stateCaption ? ` ${stateCaption}` : ""}${row.attention ? ", connection needs attention" : ""}${notCounted ? ", not counted towards Safe to Spend" : ""}${sync ? `, ${syncRowLine}${syncAsOf ? `, balance as of ${syncAsOf}` : ""}` : ""}`}
      className="w-full min-h-[60px] flex items-center gap-3 px-4 py-2.5 active:bg-slate-50 dark:active:bg-white/5 transition-colors motion-reduce:transition-none text-left cursor-pointer"
    >
      <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText={brand.label} brandBg={brand.background} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          {isPinned && <Star size={11} className="fill-current text-amber-400 flex-shrink-0" aria-hidden="true" />}
          <span className={`min-w-0 truncate text-[15px] font-semibold ${muted ? "text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-slate-100"}`}>
            {row.name}
          </span>
        </div>
        <div className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] mt-0.5 ${muted ? "text-slate-400 dark:text-slate-600" : "text-slate-500 dark:text-slate-400"}`}>
          {row.attention && (
            <>
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />
              <span className="sr-only">Connection needs attention. </span>
            </>
          )}
          <span className="truncate">
            {row.provider} · {accountKindLabel(row.kind)}
          </span>
          {notCounted && (
            <span data-g231-not-counted className="-ml-1 shrink-0 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              <span aria-hidden="true">· </span>Not counted
            </span>
          )}
        </div>

        {showUtilisation && utilisation && <UtilisationBar pct={utilisation.pct} limit={utilisation.limit} />}
      </div>

      <div className="shrink-0 flex flex-col items-end gap-1">
        {isInvestment && sparkline && sparkline.length > 0 && <MiniSparkline series={sparkline} />}
        <p
          className={`text-[16px] font-semibold ${balancePending ? "" : "money "}${sync ? "flex items-center gap-2 " : ""}${
            amountToneClass ? amountToneClass : isCredit
              ? isCreditAccruing
                ? "text-rose-600 dark:text-rose-400"
                : muted
                  ? "text-slate-400 dark:text-slate-500"
                  : "text-slate-900 dark:text-slate-100"
              : negative
                ? "text-rose-600 dark:text-rose-400"
                : muted
                  ? "text-slate-400 dark:text-slate-500"
                  : "text-slate-900 dark:text-slate-100"
          }`}
        >
          {sync ? <SyncGlyph phase={syncPhaseNow!} /> : null}
          {balancePending ? "Pending" : amountText}
        </p>
        {sync && !balancePending ? (
          <p data-sync-phase={syncPhaseNow} className="text-[10px] text-slate-600 dark:text-slate-300">
            {`${syncAsOf ? `As of ${syncAsOf} · ` : ""}${syncWord}`}
          </p>
        ) : null}
        {/* Visual "owed"/"in credit" caption is gone on credit rows per
            Variant B — the minus sign above plus the terms chip below carry
            that meaning instead, so the right column never stacks three
            deep. Non-credit rows are untouched: "overdrawn" still renders. */}
        {!isCredit && stateCaption && <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{stateCaption}</p>}

        {/* Card-terms pill / Add-rates affordance — mirrors AccountMiniCard's
            calm-variant treatment. APR is information, not alarm (muted
            slate); amber only when a confirmed 0% promo is genuinely close
            to ending (Red Is Risk stays reserved for real risk states). This
            is the single chip Variant B allows under the amount — never a
            second stacked caption alongside it. */}
        {isCredit && termsPill && onTermsClick ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTermsClick();
            }}
            aria-label={`${termsPill.label}, edit this card's rates`}
            className="mt-0.5 min-h-[28px] flex items-center active:opacity-70 transition-opacity motion-reduce:transition-none"
          >
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full num ${
                termsPill.amber
                  ? "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
                  : "bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400"
              }`}
            >
              {termsPill.label}
            </span>
          </button>
        ) : isCredit && onAddRates ? (
          // No recorded terms at all — Variant B's "Add APR ›" chip fills the
          // same one-chip slot, same size, so an unknown card never grows a
          // second line either. Chip stays visually 22px (matches the terms
          // pill above and the design source), but the button's hit area is
          // padded out to 44px via the invisible before:inset overlay so it
          // doesn't inflate the row's flex layout the way a literal min-h
          // would.
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddRates();
            }}
            className="relative mt-0.5 min-h-[22px] flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/25 text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity motion-reduce:transition-none before:absolute before:-inset-y-[11px] before:-inset-x-2 before:content-['']"
          >
            Add APR ›
          </button>
        ) : null}
      </div>
    </div>
  );
}
