"use client";

import Link from "next/link";
import { Landmark, Plus, TrendingUp, Upload } from "lucide-react";
import { LEGACY_BANK_AVAILABLE, LEGACY_BANK_MENU_LABEL } from "@/lib/legacyBankProvider";
import { RESUBSCRIBE_HREF } from "@/lib/billingCopy";

export interface AccountsAddMenuProps {
  allowed: boolean;
  ready: boolean;
  onBank: (provider: "finexer" | "legacy") => void;
  onStatement: () => void;
  onInvestment: () => void;
  onOffline: () => void;
}

const rowClass = "flex w-full min-h-11 items-center gap-2.5 rounded-lg px-3 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 disabled:text-slate-500 dark:text-slate-200 dark:hover:bg-white/5 dark:active:bg-white/10 dark:disabled:text-slate-400";

/** G389 F6: actions name what happens next; restrictions have a way forward. */
export default function AccountsAddMenu({ allowed, ready, onBank, onStatement, onInvestment, onOffline }: AccountsAddMenuProps) {
  return <div role="menu" aria-label="Add an account" className="absolute right-0 top-[calc(100%+8px)] z-30 w-[min(290px,calc(100vw-64px))] rounded-2xl border border-slate-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-slate-800">
    <button type="button" role="menuitem" data-tutorial-id="tutorial-add-bank" disabled={!allowed || !ready} aria-describedby={!allowed ? "accounts-bank-access" : undefined} className={rowClass} onClick={() => onBank("finexer")}><Landmark size={16} aria-hidden="true" className="shrink-0" />Connect a bank</button>
    {!allowed && <div className="px-3 pb-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
      <p id="accounts-bank-access">{ready ? "Bank connection is not included in your plan. Upload a statement or manage your subscription to connect a bank." : "Checking bank connection access…"}</p>
      {ready && <Link href={RESUBSCRIBE_HREF} role="menuitem" className="mt-1 inline-flex min-h-11 items-center rounded-lg px-1 font-semibold text-indigo-700 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">Manage subscription</Link>}
    </div>}
    {allowed && ready && LEGACY_BANK_AVAILABLE && <button type="button" role="menuitem" className={rowClass} onClick={() => onBank("legacy")}><Landmark size={16} aria-hidden="true" />{LEGACY_BANK_MENU_LABEL}</button>}
    <button type="button" role="menuitem" data-tutorial-id="tutorial-add-statement" className={rowClass} onClick={onStatement}><Upload size={16} aria-hidden="true" />Upload a statement</button>
    <button type="button" role="menuitem" data-tutorial-id="tutorial-add-investment" className={rowClass} onClick={onInvestment}><TrendingUp size={16} aria-hidden="true" />Add an investment</button>
    <button type="button" role="menuitem" data-tutorial-id="tutorial-add-offline" className={rowClass} onClick={onOffline}><Plus size={16} aria-hidden="true" />Add an offline account</button>
  </div>;
}
