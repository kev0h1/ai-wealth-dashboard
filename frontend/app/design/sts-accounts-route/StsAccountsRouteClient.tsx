"use client";

// G219 design round (skill: impeccable). Renders the PRODUCTION
// components/SafeToSpendCard through its real props, with fixture data only.
// `accountsRoute` is the new optional prop; absent, the card is exactly today's.
//
// /design/sts-accounts-route?variant=today|a|b|c&state=on-track|tight|card|short-cash|short-plans|syncing&logos=on|missing&mode=light|dark
//
// What this complements on Home: the "Your estate" header further down the page
// already has a Manage link to /accounts (HomePage.tsx, tutorial-manage-link),
// and its account mini-cards deep-link with /accounts?id=<id>. The hero route
// complements it rather than replacing it: Manage is about the whole estate and
// sits below the fold, the hero route is about the accounts behind this figure
// and sits where the question arises. Variant A reuses the same ?id= deep link.
// G135 (a fresh user with no route to Accounts) is already resolved by A67,
// whose FirstAccountCard sends a new user to /accounts, so this round does not
// need to solve it.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import SafeToSpendCard, { accountDeepLink, type AccountsRoute } from "@/components/SafeToSpendCard";
import { FIGURE_DATA } from "../safe-to-spend-figure/fixtures";
import {
  ALL_ACCOUNTS,
  ALL_ACCOUNTS_METRO,
  ROUTE_STATES,
  SPEND_FROM_NAMED,
  SPEND_FROM_RAIL,
  SYNCING_INFO,
  type RouteState,
} from "./fixtures";

type Mode = "light" | "dark";
type Variant = "today" | "a" | "b" | "c";
type Logos = "on" | "missing";

const VARIANTS: { id: Variant; label: string; blurb: string }[] = [
  { id: "today", label: "Today", blurb: "The shipped hero, for comparison. No route to Accounts." },
  { id: "a", label: "A · Rows", blurb: "Each Spend from row opens that account. Chevron cue, 44px rows." },
  { id: "b", label: "B · Link", blurb: "One quiet Your accounts link beside the primary action. It sits below the disclaimer line, and the fold-in would decide whether it moves above it." },
  { id: "c", label: "C · Strip", blurb: "Bank badges and a linked-account count, one link to Accounts." },
];

const noop = () => {};

function routeFor(variant: Variant, logos: Logos): AccountsRoute | undefined {
  switch (variant) {
    case "a":
      return { kind: "rows", accountHref: accountDeepLink };
    case "b":
      return { kind: "link", href: "/accounts" };
    case "c":
      return { kind: "strip", href: "/accounts", accounts: logos === "missing" ? ALL_ACCOUNTS_METRO : ALL_ACCOUNTS };
    default:
      return undefined;
  }
}

const pill = "inline-flex min-h-11 items-center rounded-full px-3.5 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const pillOn = "bg-indigo-600 text-white";
const pillOff = "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300";

export default function StsAccountsRouteClient() {
  const params = useSearchParams();
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const rawVariant = params.get("variant");
  const variant: Variant = VARIANTS.some((v) => v.id === rawVariant) ? (rawVariant as Variant) : "a";
  const rawState = params.get("state");
  const state: RouteState = ROUTE_STATES.some((s) => s.id === rawState) ? (rawState as RouteState) : "on-track";
  const logos: Logos = params.get("logos") === "missing" ? "missing" : "on";

  const href = (next: Partial<{ variant: Variant; state: RouteState; mode: Mode; logos: Logos }>) =>
    `?variant=${next.variant ?? variant}&state=${next.state ?? state}&logos=${next.logos ?? logos}&mode=${next.mode ?? mode}`;

  const syncing = state === "syncing";
  const data = syncing ? FIGURE_DATA["on-track"] : FIGURE_DATA[state];

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <main className={`min-h-screen px-4 pb-16 pt-6 ${mode === "dark" ? "bg-slate-950" : "bg-slate-100"}`}>
        <div className="mx-auto max-w-md">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">G219 · Safe to Spend, route to Accounts</p>
          <p className="mt-1 text-[13px] leading-snug text-slate-600 dark:text-slate-300">
            Three ways to reach the accounts behind the figure, all secondary to the one primary action. It complements Home&apos;s Your estate Manage link, which stays. G135 is already resolved by A67.
          </p>

          <nav aria-label="Variant" className="mt-3 flex flex-wrap gap-2">
            {VARIANTS.map((v) => (
              <Link key={v.id} href={href({ variant: v.id })} aria-current={variant === v.id ? "true" : undefined} className={`${pill} ${variant === v.id ? pillOn : pillOff}`}>{v.label}</Link>
            ))}
          </nav>
          <nav aria-label="State" className="mt-2 flex flex-wrap gap-2">
            {ROUTE_STATES.map((s) => (
              <Link key={s.id} href={href({ state: s.id })} aria-current={state === s.id ? "true" : undefined} className={`${pill} ${state === s.id ? pillOn : pillOff}`}>{s.label}</Link>
            ))}
          </nav>
          <nav aria-label="Appearance" className="mt-2 flex flex-wrap gap-2">
            <Link href={href({ logos: logos === "on" ? "missing" : "on" })} className={`${pill} ${logos === "missing" ? pillOn : pillOff}`}>{logos === "missing" ? "Logo missing: on" : "Logo missing: off"}</Link>
            <Link href={href({ mode: mode === "dark" ? "light" : "dark" })} className={`${pill} ${pillOff}`}>{mode === "dark" ? "Light" : "Dark"}</Link>
          </nav>

          <p className="mt-3 text-[12px] text-slate-500 dark:text-slate-400">{VARIANTS.find((v) => v.id === variant)?.blurb}</p>

          <div className="mt-3">
            <SafeToSpendCard
              data={data ?? null}
              loading={false}
              onRetry={noop}
              spendFrom={logos === "missing" ? SPEND_FROM_NAMED : SPEND_FROM_RAIL}
              syncing={syncing ? SYNCING_INFO : undefined}
              onSyncRetry={noop}
              previewBalancesVisible
              accountsRoute={routeFor(variant, logos)}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
