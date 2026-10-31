"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, ArrowRight, Check, CircleAlert, LoaderCircle } from "lucide-react";
import { api } from "@/lib/api";
import { TRANSACTIONS_CHANGED_EVENT } from "@/lib/cacheInvalidation";

export type TransferCheckState = { status: "loading" | "failed" } | { status: "ready"; count: number };
const reviewHref = "/spend?review=1";
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 dark:focus-visible:ring-indigo-300 dark:focus-visible:ring-offset-slate-900";
const surface = "rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";

/** The review sheet is all-time. The older count/pair_count fields cover only
 * one pay period and cannot stand in for it, even when they happen to be zero. */
export function transferReviewCount(data: { review_total?: number }): number {
  if (!Number.isSafeInteger(data.review_total) || data.review_total! < 0) throw new Error("Missing transfer review total");
  return data.review_total!;
}

export function HomeTransfersCheckView({ state, onRetry }: { state: TransferCheckState; onRetry: () => void }) {
  if (state.status === "loading") return (
    <div role="status" className="flex min-h-11 items-center gap-2.5 px-1 py-2 text-sm text-slate-600 dark:text-slate-300">
      <LoaderCircle size={18} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />Checking for transfers…
    </div>
  );
  if (state.status === "failed") return (
    <section className={`${surface} p-4`} aria-label="Transfer check unavailable">
      <div className="flex items-start gap-3"><CircleAlert size={19} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-300" /><div>
        <h3 className="text-sm font-semibold">Transfers couldn’t be checked</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">Try again or open transfer review.</p>
      </div></div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={onRetry} className={`min-h-11 rounded-xl bg-slate-100 px-3.5 py-2.5 text-sm font-semibold hover:bg-slate-200 active:opacity-80 dark:bg-slate-700 dark:hover:bg-slate-600 ${focus}`}>Try again</button>
        <Link href={reviewHref} className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-indigo-700 hover:underline active:opacity-80 dark:text-indigo-300 ${focus}`}>Review transfers <ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
    </section>
  );
  if (state.count === 0) return (
    <div className="flex min-h-11 items-center gap-2.5 px-1 py-2 text-sm text-slate-600 dark:text-slate-300">
      <Check size={18} aria-hidden="true" className="shrink-0 text-emerald-700 dark:text-emerald-300" />Transfers all checked
    </div>
  );
  return (
    <section className={`${surface} p-5`} aria-label="Check your transfers">
      <div className="flex items-center gap-3">
        <ArrowLeftRight size={21} aria-hidden="true" className="shrink-0 text-indigo-700 dark:text-indigo-300" />
        <h3 className="flex-1 text-base font-bold">Check your transfers</h3>
        <span aria-label={`${state.count} to check`} className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-indigo-50 px-2 text-[13px] font-bold text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300">{state.count}</span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">Help Sorted tell money moved from money spent.</p>
      <Link href={reviewHref} className={`mt-4 flex min-h-11 items-center justify-center gap-2.5 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 active:opacity-80 ${focus}`}>Review transfers <ArrowRight size={17} aria-hidden="true" /></Link>
    </section>
  );
}

export default function HomeTransfersCheck({ refreshKey, enabled = true, onReady }: { refreshKey: number; enabled?: boolean; onReady?: () => void }) {
  const [state, setState] = useState<TransferCheckState>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => {
    if (!enabled) { onReadyRef.current?.(); return; }
    let current = true;
    setState({ status: "loading" });
    api.getMiscategorisedCount().then(data => {
      const count = transferReviewCount(data);
      if (current) setState({ status: "ready", count });
    }).catch(() => { if (current) setState({ status: "failed" }); })
      .finally(() => { if (current) onReadyRef.current?.(); });
    return () => { current = false; };
  }, [enabled, refreshKey, retry]);
  useEffect(() => {
    const refresh = () => setRetry(value => value + 1);
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener(TRANSACTIONS_CHANGED_EVENT, refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener(TRANSACTIONS_CHANGED_EVENT, refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  if (!enabled) return null;
  return <HomeTransfersCheckView state={state} onRetry={() => setRetry(value => value + 1)} />;
}
