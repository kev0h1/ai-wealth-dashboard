"use client";

// G303 preview (delete on fold-in): renders the PRODUCTION SafeToSpendCard with
// synthetic props for the combined and per-account Spend from cases.
// /design/g303-spend-from?case=combined|same-bank|per-account&mode=light|dark&move=0|1

import { useEffect, useLayoutEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import { usePreferences } from "@/components/PreferencesContext";
import { CASES, heroFor } from "./fixtures";

const noop = () => {};
const pill =
  "inline-flex min-h-9 items-center rounded-lg px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const pillOff = "border border-slate-200 text-slate-700 dark:border-slate-600 dark:text-slate-100";

export default function G303Client() {
  const params = useSearchParams();
  const current = CASES.find((c) => c.id === params.get("case")) ?? CASES[0];
  const dark = params.get("mode") === "dark";
  const move = params.get("move") === "1";
  const { preferencesReady, setHideNetWorth } = usePreferences();
  // G304 screenshot aid: ?open=1 expands the ledger and adds an envelope and a plan reservation.
  const open = params.get("open") === "1";
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }), 300);
    return () => window.clearInterval(t);
  }, [open, current.id]);

  useLayoutEffect(() => {
    const nativeFetch = window.fetch.bind(window);
    let version = 0;
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (!/\/preferences(?:[/?]|$)/.test(url)) return nativeFetch(input, init);
      version += 1;
      return new Response(JSON.stringify({ hide_net_worth: false, version }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof window.fetch;
    return () => {
      window.fetch = nativeFetch;
    };
  }, []);
  useEffect(() => {
    if (preferencesReady) setHideNetWorth(false);
  }, [preferencesReady, setHideNetWorth]);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      if (root.classList.contains("dark") !== dark) root.classList.toggle("dark", dark);
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", dark ? "dark" : "light");
    return () => obs.disconnect();
  }, [dark]);

  const href = (over: Record<string, string>) =>
    `?${new URLSearchParams({ case: current.id, mode: dark ? "dark" : "light", move: move ? "1" : "0", ...over }).toString()}`;

  return (
    <main className="mx-auto min-h-screen max-w-md bg-slate-50 px-4 py-6 dark:bg-slate-900">
      <nav aria-label="Preview controls" className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-14 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Case</span>
          {CASES.map((c) => (
            <Link key={c.id} href={href({ case: c.id })} aria-current={c.id === current.id ? "true" : undefined} className={`${pill} ${c.id === current.id ? "bg-indigo-600 text-white" : pillOff}`}>
              {c.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-14 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Theme</span>
          <Link href={href({ mode: dark ? "light" : "dark" })} className={`${pill} ${pillOff}`}>{dark ? "Light" : "Dark"}</Link>
          <Link href={href({ move: move ? "0" : "1" })} className={`${pill} ${pillOff}`}>{move ? "Cover move: shown" : "Cover move: none"}</Link>
        </div>
      </nav>
      <p className="mb-3 text-xs text-slate-600 dark:text-slate-300">{current.note}</p>
      <SafeToSpendCard
        data={open ? { ...heroFor(current.pool), allocations_reserved: 101.52, allocations_count: 1, commitments_reserved: 100, commitments_count: 1 } : heroFor(current.pool)}
        loading={false}
        onRetry={noop}
        spendFrom={current.spendFrom}
        coverMoveVisible={move}
        previewBalancesVisible
      />
    </main>
  );
}
