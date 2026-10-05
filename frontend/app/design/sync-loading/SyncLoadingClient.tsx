"use client";

// G214: bank-data loading state for every sync that is not a first sync.
// Renders the PRODUCTION components/SafeToSpendCard and
// components/AccountLedgerRow (plus components/SyncNote's page-level
// indicator) with fixture props only. No requests, nothing syncs, Try again
// does nothing. Drafted by openai/gpt-6-astra, rewritten to DESIGN.md under
// the impeccable skill.
// /design/sync-loading?variant=a|b|c&surface=hero|accounts&state=refresh|new-bank|background|stalled|failed&mode=light|dark&verdict=comfortable|bills-short

import { useEffect, useLayoutEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Account } from "@wealth/shared";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import AccountLedgerRow from "@/components/AccountLedgerRow";
import { AccountsSyncBanner, type SyncTreatment, type SyncingInfo } from "@/components/SyncNote";
import { usePreferences } from "@/components/PreferencesContext";
import { bankToRow } from "@/lib/accountsEstate";
import { HERO_FIXTURES } from "../safe-to-spend-hero/fixtures";
import { LEDGER_ACCOUNTS } from "../g134-home-inventory/fixtures";

type VariantId = "a" | "b" | "c";
type SurfaceId = "hero" | "accounts";
type StateId = "refresh" | "new-bank" | "background" | "stalled" | "failed";

const VARIANTS: { id: VariantId; treatment: SyncTreatment; label: string; note: string }[] = [
  { id: "a", treatment: "line", label: "A · Quiet ledger line", note: "One line with the ring under the chip, the figure in neutral ink. Accounts: the same line on the syncing bank's rows and a thin page hairline." },
  { id: "b", treatment: "stale", label: "B · Stale-marked figure", note: "The figure steps down to secondary ink with an \"as of\" caption and a ring in the chip. Accounts: a ring beside each balance." },
  { id: "c", treatment: "drawer", label: "C · Ledger drawer", note: "The Full calculation ledger opens with one \"Fetching from\" row in the sign-in ledger grammar. Accounts: a collapsible sync ledger at the top." },
];
const STATES: { id: StateId; label: string; note: string }[] = [
  { id: "refresh", label: "Refresh", note: "Manual refresh: Barclays is being re-fetched." },
  { id: "new-bank", label: "New bank", note: "An established user added Monzo. Its balance is not in the figure yet, and the row says so rather than showing £0." },
  { id: "background", label: "Background", note: "A scheduled sync started on its own. Same words as refresh." },
  { id: "stalled", label: "Stalled", note: "Past 10 minutes with no result. The ring stops, the saved figure stays, Try again appears." },
  { id: "failed", label: "Failed", note: "The sync raised an error. Plain words in ink, saved figure stays, Try again appears. The raw error is never shown." },
];
const SURFACES: { id: SurfaceId; label: string }[] = [
  { id: "hero", label: "Home hero" },
  { id: "accounts", label: "Accounts" },
];

// Fixed so screenshots are stable: the figures on screen were last good at 09:41.
const AS_OF = "2026-10-05T09:41:00";

function infoFor(state: StateId, bank: string): SyncingInfo {
  const kind = state === "new-bank" ? "new-bank" : state === "background" ? "background" : "refresh";
  return {
    kind,
    bank,
    startedAt: Date.now() - 20_000,
    stalled: state === "stalled",
    failed: state === "failed",
    asOf: kind === "new-bank" ? null : AS_OF,
  };
}

const MONZO: Account[] = [
  { id: "acc-monzo", name: "Monzo Current", type: "transaction", subtype: "current", balance: 120, currency: "GBP", provider: "Monzo", provider_id: "monzo", status: "connected" },
];

const noop = () => {};
const pill =
  "inline-flex min-h-9 items-center rounded-lg px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const pillOff = "border border-slate-200 text-slate-700 dark:border-slate-600 dark:text-slate-100";

export default function SyncLoadingClient() {
  const params = useSearchParams();
  const variant = VARIANTS.find((v) => v.id === params.get("variant")) ?? VARIANTS[0];
  const surface = SURFACES.find((s) => s.id === params.get("surface")) ?? SURFACES[0];
  const state = STATES.find((s) => s.id === params.get("state")) ?? STATES[0];
  const verdict = params.get("verdict") === "bills-short" ? "bills-short" : "comfortable";
  const dark = params.get("mode") === "dark";
  const { preferencesReady, setHideNetWorth } = usePreferences();

  // Signed out, PreferencesProvider's /preferences round trip always 401s;
  // answer it locally so the card's hide-balances state resolves to visible.
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
    `?${new URLSearchParams({ variant: variant.id, surface: surface.id, state: state.id, mode: dark ? "dark" : "light", verdict, ...over }).toString()}`;

  const bank = state.id === "new-bank" ? "Monzo" : "Barclays";
  const info = infoFor(state.id, bank);
  const barclaysSync = state.id === "new-bank" ? undefined : { info, treatment: variant.treatment };
  const monzoSync = state.id === "new-bank" ? { info, treatment: variant.treatment } : undefined;
  const rows = LEDGER_ACCOUNTS.filter((a) => a.status === "connected");

  return (
    <main className="mx-auto min-h-screen max-w-md bg-slate-50 px-4 py-6 dark:bg-slate-900">
      <nav aria-label="Preview controls" className="mb-3 space-y-2">
        {[
          { label: "Variant", items: VARIANTS.map((v) => ({ id: v.id, text: v.id.toUpperCase(), to: { variant: v.id }, on: v.id === variant.id })) },
          { label: "Surface", items: SURFACES.map((s) => ({ id: s.id, text: s.label, to: { surface: s.id }, on: s.id === surface.id })) },
          { label: "State", items: STATES.map((s) => ({ id: s.id, text: s.label, to: { state: s.id }, on: s.id === state.id })) },
        ].map((group) => (
          <div key={group.label} className="flex flex-wrap items-center gap-2">
            <span className="w-14 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">{group.label}</span>
            {group.items.map((it) => (
              <Link key={it.id} href={href(it.to)} aria-current={it.on ? "true" : undefined} className={`${pill} ${it.on ? "bg-indigo-600 text-white" : pillOff}`}>
                {it.text}
              </Link>
            ))}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-14 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Theme</span>
          <Link href={href({ mode: dark ? "light" : "dark" })} className={`${pill} ${pillOff}`}>{dark ? "Light" : "Dark"}</Link>
          {surface.id === "hero" ? (
            <Link href={href({ verdict: verdict === "bills-short" ? "comfortable" : "bills-short" })} className={`${pill} ${pillOff}`}>
              {verdict === "bills-short" ? "Verdict: short" : "Verdict: on track"}
            </Link>
          ) : null}
        </div>
      </nav>
      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{variant.label}</p>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{variant.note}</p>
      <p className="mb-4 mt-1 text-xs text-slate-600 dark:text-slate-300">{state.note}</p>

      {surface.id === "hero" ? (
        <SafeToSpendCard
          data={HERO_FIXTURES[verdict]}
          loading={false}
          error={false}
          onRetry={noop}
          syncing={info}
          syncTreatment={variant.treatment}
        />
      ) : (
        <div className="space-y-3">
          <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Accounts</p>
          <AccountsSyncBanner treatment={variant.treatment} connections={[info]} onRetry={noop} />
          <div className="glass-card overflow-hidden rounded-2xl">
            {[...rows, ...(state.id === "new-bank" ? MONZO : [])].map((acc, i) => {
              const syncing = acc.provider === "Barclays" ? barclaysSync : acc.provider === "Monzo" ? monzoSync : undefined;
              return (
                <div key={acc.id} className={i > 0 ? "border-t border-slate-100 dark:border-white/5" : ""}>
                  <AccountLedgerRow row={bankToRow(acc, [])} onClick={noop} sync={syncing} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
