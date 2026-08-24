"use client";

// Design preview — Variant B: rich 2-col account tiles (sparklines +
// utilisation bars, content fills to the bottom — explicitly fixing the
// known live-app bug where tiles leave dead space at the bottom).
// Standalone, auth-exempt (/design/* — see components/AuthProvider.tsx),
// static mock data only. See app/design/accounts-preview for the index.

import Link from "next/link";
import { ChevronRight, Plus, Star } from "lucide-react";
import { BankBadge, accountBrand } from "@/components/AccountMiniCard";
import {
  mockAccounts,
  moreCount,
  groupedAccounts,
  netWorth,
  type MockAccount,
} from "../_mockAccounts";

function PreviewNav() {
  return (
    <div className="glass-tile rounded-xl p-1 flex items-center gap-1 mb-4 text-[11px]">
      <Link href="/design/accounts-rows" className="flex-1 min-w-0 text-center py-1.5 rounded-lg text-indigo-400 font-semibold active:bg-white/10 transition-colors truncate">
        Rows
      </Link>
      <span className="flex-1 min-w-0 text-center py-1.5 rounded-lg text-slate-500 font-medium truncate">Tiles</span>
      <Link href="/design/account-detail" className="flex-1 min-w-0 text-center py-1.5 rounded-lg text-indigo-400 font-semibold active:bg-white/10 transition-colors truncate">
        Detail
      </Link>
      <Link href="/design/accounts-preview" className="flex-1 min-w-0 text-center py-1.5 rounded-lg text-slate-400 font-medium active:bg-white/10 transition-colors truncate">
        Index
      </Link>
    </div>
  );
}

function moneyStr(n: number): string {
  return `£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
}

/** Normalise a literal series into an SVG polyline path within a
 *  120x36 viewBox (preserveAspectRatio="none" stretches to the tile). */
function sparklinePath(series: number[]): { line: string; fill: string } {
  const w = 120;
  const h = 36;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const points = series.map((v, i) => {
    const x = (i / (series.length - 1)) * w;
    const y = 34 - ((v - min) / range) * 32; // 2..34, small top/bottom margin
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const fill = `0,${h} ${line} ${w},${h}`;
  return { line, fill };
}

function Sparkline({ series }: { series: number[] }) {
  const { line, fill } = sparklinePath(series);
  return (
    <svg viewBox="0 0 120 36" preserveAspectRatio="none" className="w-full h-9" aria-hidden="true">
      <polygon points={fill} fill="rgba(226,232,240,0.55)" fillOpacity="0.08" />
      <polyline points={line} stroke="rgba(226,232,240,0.55)" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

function AccountTile({ account }: { account: MockAccount }) {
  const brand = accountBrand(account);
  const isCredit = account.type === "Credit";
  const pct = isCredit && account.limit ? Math.min(100, (Math.abs(account.balance) / account.limit) * 100) : 0;
  // Direction of money, not just account kind — a credit card in credit is
  // not debt, and a negative-balance current/savings account is genuine
  // risk regardless of kind.
  const negative = account.balance < 0;
  const isOverdrawn = !isCredit && account.balance < 0;
  const stateCaption = isCredit && account.balance < 0
    ? "owed"
    : isCredit && account.balance > 0
    ? "in credit"
    : isOverdrawn
    ? "overdrawn"
    : null;
  // Unicode minus (U+2212) — a non-credit negative balance shows the signed
  // figure; credit rows keep unsigned magnitude with the "owed" caption,
  // matching the live AccountLedgerRow.tsx treatment.
  const amountText = isOverdrawn ? `−${moneyStr(account.balance)}` : moneyStr(account.balance);

  return (
    <div className="glass-card-flat rounded-2xl p-4 relative min-h-[132px] flex flex-col h-full">
      {account.pinned && (
        <Star size={11} className="fill-current text-amber-400 absolute top-3 right-3" aria-hidden="true" />
      )}

      <div className="flex items-start gap-2.5">
        <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText={brand.label} brandBg={brand.background} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-slate-100">{account.name}</p>
          <p className="text-[11px] text-slate-400 truncate mt-0.5">
            {account.provider} · {account.type}
          </p>
        </div>
      </div>

      <p className={`mt-2.5 text-xl font-bold num ${negative ? "text-rose-400" : "text-slate-100"}`}>
        {amountText}
      </p>
      {stateCaption && <p className="text-[10px] text-slate-500">{stateCaption}</p>}

      <div className="mt-auto pt-2">
        {isCredit ? (
          <>
            {account.terms && (
              <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-700/60 text-slate-400 mb-1.5">
                {account.terms}
              </span>
            )}
            <div className="h-1 rounded-full bg-slate-700/60 overflow-hidden">
              <div className="h-full rounded-full bg-rose-400/70" style={{ width: `${pct}%` }} />
            </div>
            {account.limit && (
              <p className="text-[10px] text-slate-500 mt-1">
                {Math.round(pct)}% of £{account.limit.toLocaleString("en-GB")}
              </p>
            )}
          </>
        ) : (
          <>
            {account.series && <Sparkline series={account.series} />}
            {account.lastTxn && (
              <p className="mt-1 text-[11px] text-slate-500 truncate">
                Last: {account.lastTxn.merchant} £{account.lastTxn.amount.toFixed(2)} · {account.lastTxn.daysAgo}d
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function AccountsTilesPreview() {
  const estate = mockAccounts.slice(0, 4);
  const groups = groupedAccounts(mockAccounts);
  const total = netWorth(mockAccounts);

  return (
    <div className="dark mx-auto w-full max-w-[430px] min-h-screen overflow-x-hidden bg-[#0f172a] px-4 pt-6 pb-10">
      <PreviewNav />

      {/* (a) Your estate — glance */}
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Your estate</span>
        <span className="text-[13px] font-semibold text-indigo-400">Manage &rsaquo;</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {estate.map((account) => (
          <AccountTile key={account.id} account={account} />
        ))}
        <button
          type="button"
          className="border border-dashed border-white/15 rounded-2xl flex flex-col items-center justify-center text-center p-4 min-h-[132px] gap-1.5 active:bg-white/5 transition-colors"
        >
          <Plus size={16} className="text-slate-400" aria-hidden="true" />
          <span className="text-[12px] font-medium text-slate-400">+{moreCount} more accounts</span>
          <ChevronRight size={12} className="text-slate-500" aria-hidden="true" />
        </button>
      </div>

      {/* (b) All accounts — full grouped list */}
      <div className="mt-6">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Net worth</span>
        {/* Neutral ink regardless of sign — aggregate summary, not a credit-account balance */}
        <p className="text-3xl font-bold num mt-1 text-slate-100">
          {total < 0 ? "-" : ""}
          {moneyStr(total)}
        </p>
      </div>

      <div className="mt-4">
        {groups.map((group) => (
          <div key={group.label} className="mt-6 first:mt-4">
            <div className="flex items-center justify-between px-1 mb-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group.label}</span>
              <span className="text-[11px] font-medium text-slate-400 num">
                {group.subtotal < 0 ? "-" : ""}
                {moneyStr(group.subtotal)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {group.accounts.map((account) => (
                <AccountTile key={account.id} account={account} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
