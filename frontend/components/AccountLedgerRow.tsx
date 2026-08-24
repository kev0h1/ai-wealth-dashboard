"use client";

// Shared ledger-row primitive for the accounts-estate redesign. Renders one
// normalized EstateRow (bank account OR investment) — adapted from the
// approved design preview's `AccountLedgerRow` in
// app/design/accounts-rows/page.tsx, but consuming real data via EstateRow
// instead of the preview's MockAccount fixture.
//
// Rendered across AccountsPage and HomePage.

import { Percent, RefreshCw, Star } from "lucide-react";
import { BankBadge, accountBrand, type TermsPill } from "./AccountMiniCard";
import { accountKindLabel } from "@/lib/accountKind";
import type { EstateRow } from "@/lib/accountsEstate";
import type { Account } from "@wealth/shared";

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
  onReconnect?: (row: EstateRow) => void;
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
}

export default function AccountLedgerRow({
  row,
  pinned,
  onReconnect,
  onClick,
  showUtilisation,
  utilisation,
  sparkline,
  termsPill,
  onTermsClick,
  onAddRates,
}: AccountLedgerRowProps) {
  const brand = accountBrand(brandAccountFor(row));
  const isCredit = row.kind === "Credit";
  const isInvestment = row.kind === "Investment";
  const muted = row.dormant;
  const isPinned = pinned ?? row.pinned;

  // Direction of money, not just account kind — an overdrawn current/savings
  // account is genuine risk (Red Is Risk), a credit card in credit is not
  // debt at all. isDormant only ever matches balance === 0, so a negative
  // balance is never also muted.
  const isOverdrawn = !isCredit && row.balance < 0;
  const isOwedOnCredit = isCredit && row.balance < 0;
  const isCreditInCredit = isCredit && row.balance > 0;
  const negative = row.balance < 0;
  const amountText = isOverdrawn ? `${MINUS}${moneyStr(row.balance)}` : moneyStr(row.balance);
  const stateCaption = isOwedOnCredit ? "owed" : isCreditInCredit ? "in credit" : isOverdrawn ? "overdrawn" : null;

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
      aria-label={`${row.name}, ${moneyStr(row.balance)}${stateCaption ? ` ${stateCaption}` : ""}`}
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
          <span className="truncate">
            {row.provider} · {accountKindLabel(row.kind)}
          </span>
        </div>

        {showUtilisation && utilisation && <UtilisationBar pct={utilisation.pct} limit={utilisation.limit} />}

        {row.attention && (
          <button
            type="button"
            onClick={
              onReconnect
                ? (e) => {
                    e.stopPropagation();
                    onReconnect(row);
                  }
                : undefined
            }
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 active:opacity-70 transition-opacity motion-reduce:transition-none"
          >
            <RefreshCw size={11} aria-hidden="true" />
            Reconnect
          </button>
        )}
      </div>

      <div className="shrink-0 flex flex-col items-end gap-1">
        {isInvestment && sparkline && sparkline.length > 0 && <MiniSparkline series={sparkline} />}
        <p
          className={`text-[16px] font-semibold money ${
            negative ? "text-rose-600 dark:text-rose-400" : muted ? "text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-slate-100"
          }`}
        >
          {amountText}
        </p>
        {stateCaption && <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{stateCaption}</p>}

        {/* Card-terms pill / Add-rates affordance — mirrors AccountMiniCard's
            calm-variant treatment. APR is information, not alarm (muted
            slate); amber only when a confirmed 0% promo is genuinely close
            to ending (Red Is Risk stays reserved for real risk states). */}
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
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddRates();
            }}
            className="mt-0.5 min-h-[28px] flex items-center gap-1 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity motion-reduce:transition-none"
          >
            <Percent size={10} aria-hidden="true" />
            Add rates
          </button>
        ) : null}
      </div>
    </div>
  );
}
