"use client";

// Shared bits across all three account-rows variants: the bank badge/brand
// resolver, the plain account row (current/savings/pinned — unchanged by
// this brief, kept identical across A/B/C as the control), and the group
// header. Only the CREDIT row differs per variant; see VariantA/B/C.tsx.

import { accountBrand, BankBadge } from "@/components/AccountMiniCard";
import { accountKindLabel } from "@/lib/accountKind";
import type { Account } from "@/lib/api";
import type { RowFixture } from "./fixtures";
import { subtotal } from "./fixtures";

const MINUS = "−"; // matches MoneyText / AccountLedgerRow's unicode minus

export function moneyStr(n: number): string {
  return `£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
}

export function amountText(n: number): string {
  return n < 0 ? `${MINUS}${moneyStr(n)}` : moneyStr(n);
}

/** Minimal Account stand-in so accountBrand()/bankKey() resolve — mirrors
 *  AccountLedgerRow's brandAccountFor for the same reason: fixtures aren't
 *  real bank Account records. */
export function brandFor(row: RowFixture): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.kind,
    balance: row.balance,
    currency: "GBP",
    provider: row.provider,
    status: "connected",
  };
}

export function RowBadge({ row }: { row: RowFixture }) {
  const brand = accountBrand(brandFor(row));
  return <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText={brand.label} brandBg={brand.background} />;
}

export function bankLabel(row: RowFixture): string {
  return accountBrand(brandFor(row)).label;
}

/** Plain ledger row for current/savings/pinned accounts — byte-identical
 *  across all three variants (the brief's complaint is only about credit
 *  rows; this is the "account-row grammar" they should match). */
export function AccountRow({ row }: { row: RowFixture }) {
  const negative = row.balance < 0;
  const caption = negative ? (row.kind === "Current" ? "overdrawn" : null) : null;
  return (
    <div className="w-full min-h-[60px] flex items-center gap-3 px-4 py-2.5">
      <RowBadge row={row} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <span className="min-w-0 truncate text-[15px] font-semibold text-slate-900 dark:text-slate-100">{row.name}</span>
        </div>
        <p className="text-[12.5px] mt-0.5 text-slate-500 dark:text-slate-400 truncate">
          {bankLabel(row)} · {accountKindLabel(row.kind)}
        </p>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-0.5">
        <p className={`text-[16px] font-semibold money ${negative ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"}`}>
          {amountText(row.balance)}
        </p>
        {caption && <p className="text-[10px] text-slate-400 dark:text-slate-500">{caption}</p>}
      </div>
    </div>
  );
}

export function GroupHeader({ label, rows }: { label: string; rows: RowFixture[] }) {
  const total = subtotal(rows);
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 bg-slate-50/95 dark:bg-slate-900/90 border border-slate-100/80 dark:border-white/5">
      <span className="flex items-baseline gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
        <span className="text-slate-400 dark:text-slate-600 font-medium normal-case">· {rows.length}</span>
      </span>
      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 money">
        {total < 0 ? "-" : ""}£{Math.abs(Math.round(total)).toLocaleString("en-GB")}
      </span>
    </div>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return <div className="glass-card rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-white/5">{children}</div>;
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-1 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{children}</p>;
}
