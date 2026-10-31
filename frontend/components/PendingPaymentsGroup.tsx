"use client";

import Link from "next/link";
import { Clock3 } from "lucide-react";
import type { Transaction } from "@/lib/api";
import TransactionRow from "@/components/TransactionRow";

interface PendingPaymentsGroupProps {
  items: Transaction[];
  total?: number;
  onLoadMore?: () => void;
  moreHref?: string;
  loadingMore?: boolean;
  error?: string | null;
}

/** Approved G373 B: provisional activity is a separate, counted group. */
export default function PendingPaymentsGroup({
  items, total = items.length, onLoadMore, moreHref, loadingMore = false, error,
}: PendingPaymentsGroupProps) {
  if (!items.length && !error && !loadingMore) return null;
  const actionClass = "inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-slate-700 touch-manipulation disabled:opacity-60";
  return (
    <section aria-label="Pending payments" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex min-w-0 items-center gap-2">
          <Clock3 size={16} aria-hidden="true" className="shrink-0 text-slate-500 dark:text-slate-400" />
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Pending payments</h2>
        </div>
        {(!error || items.length > 0) && <span className="shrink-0 rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{total}</span>}
      </div>
      <div>{items.map(transaction => <TransactionRow key={transaction.id} transaction={transaction} showActivityDate />)}</div>
      {error && <p role="status" className="px-4 pt-3 text-sm text-slate-600 dark:text-slate-300">{error}</p>}
      {(error || loadingMore || items.length < total) && <div className="border-t border-slate-100 px-2 py-1 dark:border-slate-700">
        {moreHref ? <Link href={moreHref} className={actionClass}>See all pending payments</Link> : onLoadMore ? <button type="button" onClick={onLoadMore} disabled={loadingMore} className={actionClass}>{loadingMore ? "Loading pending payments…" : error ? "Try again" : "Show more pending payments"}</button> : loadingMore ? <p role="status" className="px-2 py-3 text-sm text-slate-500 dark:text-slate-400">Loading pending payments…</p> : null}
      </div>}
    </section>
  );
}
