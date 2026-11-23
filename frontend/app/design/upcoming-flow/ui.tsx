"use client";

import { AlertTriangle, ArrowRight, Check, CircleHelp, CircleMinus, Clock3 } from "lucide-react";
import { BankIcon, BANK_META, bankKey } from "@/components/AccountMiniCard";
import MoneyText from "@/components/MoneyText";
import { displayAccountName } from "@/lib/accountName";
import type { PreviewAccount } from "./types";

export const focusClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 scroll-mb-28";
export const containedFocusClass = "touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 scroll-mb-28";
export const quietClass = "text-slate-600 dark:text-slate-300";
export const surfaceClass = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none";

export function bankLabel(account: PreviewAccount): string {
  return BANK_META[bankKey({ provider: account.bank })]?.label ?? displayAccountName(account.bank);
}
export const accountLabel = (account: PreviewAccount): string => displayAccountName(account.name);
export function dateLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`)).replace(",", "");
}
export function moneyText(pence: number, signed = false): string {
  const value = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(pence / 100).replace("-", "−");
  return signed && pence > 0 ? `+${value}` : value;
}
export function Money({ value, className = "", signed = false }: { value: number | null; className?: string; signed?: boolean }) {
  if (value === null) return <span className={`text-sm font-medium ${quietClass} ${className}`}>Unavailable</span>;
  return <span className={`font-mono tabular-nums ${className}`}><MoneyText text={moneyText(value, signed)} /></span>;
}
export function MoneyCopy({ text, className }: { text: string; className?: string }) {
  return <MoneyText text={text} className={className} />;
}
export function AccountIdentity({ account, compact = false }: { account: PreviewAccount; compact?: boolean }) {
  return <span className="flex min-w-0 items-center gap-3"><span className="shrink-0" aria-hidden="true"><BankIcon identity={{ provider: account.bank }} size={compact ? 28 : 32} altText="" /></span><span className="min-w-0"><strong className={`block text-pretty font-bold leading-5 ${compact ? "text-sm" : "text-base"}`}>{bankLabel(account)}</strong><span className={`mt-0.5 block text-pretty text-xs leading-5 ${quietClass}`}>{accountLabel(account)}</span></span></span>;
}
export function AccountStatus({ account }: { account: PreviewAccount }) {
  const tones = {
    short: "text-rose-700 dark:text-rose-300",
    move: "text-amber-800 dark:text-amber-200",
    funding: "text-indigo-700 dark:text-indigo-300",
    covered: "text-slate-600 dark:text-slate-300",
    checking: "text-slate-600 dark:text-slate-300",
    plans: "text-slate-600 dark:text-slate-300",
  };
  const Icon = account.status === "short" ? AlertTriangle : account.status === "covered" ? Check : account.status === "checking" ? Clock3 : account.status === "funding" ? ArrowRight : account.status === "plans" ? CircleMinus : CircleHelp;
  return <span data-account-status={account.status} className={`inline-flex items-center gap-1.5 text-xs font-semibold leading-5 ${tones[account.status]}`}><Icon size={14} className="shrink-0" aria-hidden="true" /><span>{account.statusLabel}</span></span>;
}
export function AccountAmount({ account }: { account: PreviewAccount }) {
  if (account.purpose === "card") return <span className={`block text-xs leading-5 ${quietClass}`}>Cash has not<br />left yet</span>;
  if (account.status === "checking") return <span aria-busy="true" className="block"><span aria-hidden="true" className="ml-auto block h-6 w-20 rounded-md bg-slate-100 dark:bg-slate-700" /><span className={`mt-1 block text-xs ${quietClass}`}>Figure pending</span></span>;
  const value = account.availabilityPence ?? (account.purpose === "source" ? account.cashNowPence : account.afterPaymentsPence);
  const label = account.availabilityLabel ?? (account.purpose === "source" ? "Bank balance" : "After payments");
  return <span className="block"><Money value={value} className="text-[19px] font-bold leading-7" /><span className={`mt-0.5 block max-w-[11rem] text-xs font-normal leading-5 ${quietClass}`}>{label}</span></span>;
}
