"use client";

// G219, approved B and folded in (Kevin 2026-10-06). Renders ONLY the
// production components/SafeToSpendCard through its real props, with fixture
// data, so the preview cannot drift from what shipped. The "Your accounts" link
// is the card's default now; there is no variant switcher.
//
// /design/sts-accounts-route?state=on-track|tight|card|short-cash|short-plans|syncing&logos=on|missing&mode=light|dark

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import { FIGURE_DATA } from "../safe-to-spend-figure/fixtures";
import { ROUTE_STATES, SPEND_FROM_NAMED, SPEND_FROM_RAIL, SYNCING_INFO, type RouteState } from "./fixtures";

type Mode = "light" | "dark";
type Logos = "on" | "missing";

const noop = () => {};

const pill = "inline-flex min-h-11 items-center rounded-full px-3.5 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const pillOn = "bg-indigo-600 text-white";
const pillOff = "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300";

export default function StsAccountsRouteClient() {
  const params = useSearchParams();
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const rawState = params.get("state");
  const state: RouteState = ROUTE_STATES.some((s) => s.id === rawState) ? (rawState as RouteState) : "on-track";
  const logos: Logos = params.get("logos") === "missing" ? "missing" : "on";

  const href = (next: Partial<{ state: RouteState; mode: Mode; logos: Logos }>) =>
    `?state=${next.state ?? state}&logos=${next.logos ?? logos}&mode=${next.mode ?? mode}`;

  const syncing = state === "syncing";
  const data = syncing ? FIGURE_DATA["on-track"] : FIGURE_DATA[state];

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <main className={`min-h-screen px-4 pb-16 pt-6 ${mode === "dark" ? "bg-slate-950" : "bg-slate-100"}`}>
        <div className="mx-auto max-w-md">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">G219 · Safe to Spend, route to Accounts</p>
          <p className="mt-1 text-[13px] leading-snug text-slate-600 dark:text-slate-300">
            Approved B, folded in. The quiet Your accounts link sits in the action row below the disclaimer, beside the primary action or alone. It complements Home&apos;s Your estate Manage link, which stays.
          </p>

          <nav aria-label="State" className="mt-3 flex flex-wrap gap-2">
            {ROUTE_STATES.map((s) => (
              <Link key={s.id} href={href({ state: s.id })} aria-current={state === s.id ? "true" : undefined} className={`${pill} ${state === s.id ? pillOn : pillOff}`}>{s.label}</Link>
            ))}
          </nav>
          <nav aria-label="Appearance" className="mt-2 flex flex-wrap gap-2">
            <Link href={href({ logos: logos === "on" ? "missing" : "on" })} className={`${pill} ${logos === "missing" ? pillOn : pillOff}`}>{logos === "missing" ? "Logo missing: on" : "Logo missing: off"}</Link>
            <Link href={href({ mode: mode === "dark" ? "light" : "dark" })} className={`${pill} ${pillOff}`}>{mode === "dark" ? "Light" : "Dark"}</Link>
          </nav>

          <div className="mt-3">
            <SafeToSpendCard
              data={data ?? null}
              loading={false}
              onRetry={noop}
              spendFrom={logos === "missing" ? SPEND_FROM_NAMED : SPEND_FROM_RAIL}
              syncing={syncing ? SYNCING_INFO : undefined}
              onSyncRetry={noop}
              previewBalancesVisible
            />
          </div>
        </div>
      </main>
    </div>
  );
}
