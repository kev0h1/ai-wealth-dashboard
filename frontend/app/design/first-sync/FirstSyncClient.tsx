"use client";

// G210: first bank sync state. Renders the PRODUCTION components/FirstSyncCard
// and components/SafeToSpendCard with fixture props only, so it cannot drift
// from the app. No requests, nothing syncs, Try again and Connect do nothing.
// /design/first-sync?state=syncing|stalled|failed|sts-syncing&mode=light|dark

import { useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import FirstSyncCard, { type FirstSyncConnection } from "@/components/FirstSyncCard";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import type { SafeToSpend } from "@/lib/api";

type StateId = "syncing" | "stalled" | "failed" | "sts-syncing";

const STATES: { id: StateId; label: string; note: string }[] = [
  { id: "syncing", label: "Syncing", note: "Bank connected a moment ago, transactions on their way." },
  { id: "stalled", label: "Stalled", note: "Authorised more than 10 minutes ago with no result." },
  { id: "failed", label: "Failed", note: "The first sync raised an error. The raw error is never shown." },
  { id: "sts-syncing", label: "Safe to Spend, syncing", note: "The verdict slot while accounts exist but the first sync is still running." },
];

const CONNECTIONS: FirstSyncConnection[] = [
  { provider: "finexer", connection_id: "fixture", bank: "ob-barclays", started_at: "2026-10-04T09:00:00Z", error: null },
];

// Only calculation_status and status are read by the syncing branch.
const SYNCING_DATA = { status: "ok", calculation_status: "syncing", sync_state: "syncing", safe_to_spend: 0, safe_to_spend_cash: 0 } as unknown as SafeToSpend;

const noop = () => {};
const pill =
  "inline-flex min-h-9 items-center rounded-lg px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export default function FirstSyncClient() {
  const params = useSearchParams();
  const state = STATES.find((s) => s.id === params.get("state")) ?? STATES[0];
  const dark = params.get("mode") === "dark";

  useEffect(() => {
    // PreferencesProvider's own effect runs after this one and strips the
    // class (its darkMode is false when signed out), so keep re-applying.
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
    `?${new URLSearchParams({ state: state.id, mode: dark ? "dark" : "light", ...over }).toString()}`;

  return (
    <main className="mx-auto min-h-screen max-w-md bg-slate-50 px-4 py-6 dark:bg-slate-900">
      <nav aria-label="Preview controls" className="mb-4 flex flex-wrap gap-2">
        {STATES.map((s) => (
          <Link
            key={s.id}
            href={href({ state: s.id })}
            aria-current={s.id === state.id ? "true" : undefined}
            className={`${pill} ${s.id === state.id ? "bg-indigo-600 text-white" : "border border-slate-200 text-slate-700 dark:border-slate-600 dark:text-slate-100"}`}
          >
            {s.label}
          </Link>
        ))}
        <Link href={href({ mode: dark ? "light" : "dark" })} className={`${pill} border border-slate-200 text-slate-700 dark:border-slate-600 dark:text-slate-100`}>
          {dark ? "Light" : "Dark"}
        </Link>
      </nav>
      <p className="mb-4 text-xs text-slate-600 dark:text-slate-300">{state.note}</p>
      {state.id === "sts-syncing" ? (
        <SafeToSpendCard data={SYNCING_DATA} loading={false} error={false} onRetry={noop} />
      ) : (
        <FirstSyncCard state={state.id} connections={CONNECTIONS} onRetry={noop} onConnect={noop} />
      )}
    </main>
  );
}
