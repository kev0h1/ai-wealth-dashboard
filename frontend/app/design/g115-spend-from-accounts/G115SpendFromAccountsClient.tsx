"use client";

// G115 design round. Variant A now renders SafeToSpendCard's approved
// production treatment with no visual override. The narrow spendFromPreview
// seam keeps rejected B/C available as design history while the hero,
// calculation and cover-plan card remain the shipped components. Fixtures
// are local and pass through bestSpendAccount(), the same selector Home uses,
// so reserved headroom, current-only ranking and the credit-card exclusion
// remain production behaviour rather than preview claims.

import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { BankBadge, BANK_META, accountBrand, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import { MoveCard } from "@/components/HomeBrief";
import { usePreferences } from "@/components/PreferencesContext";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import type { SpendFromAccount, SpendFromResult } from "@/lib/spendFromAccount";
import { FIXTURES, STATE_ORDER, type PreviewState } from "./fixtures";

type Variant = "a" | "b" | "c";
type Mode = "light" | "dark";

const VARIANTS: Record<Variant, { name: string; description: string }> = {
  a: {
    name: "Bank rail",
    description: "Kevin’s direction: a small bank-and-amount stack beside the hero, with the scope explanation left in the reading flow.",
  },
  b: {
    name: "Inline pair",
    description: "Two named accounts share one compact line below the verdict, keeping identity and amounts visible without creating another panel.",
  },
  c: {
    name: "Quiet rows",
    description: "Two full-width rows favour long account names and explicit bank identity, at the cost of a little more height.",
  },
};

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function money(value: number, hidden: boolean): string {
  return hidden
    ? "£••••"
    : `£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function spendAccounts(result: SpendFromResult): SpendFromAccount[] {
  if (result.kind !== "account") return [];
  return [result.best, result.alternative].filter((entry): entry is SpendFromAccount => entry != null);
}

function localBank(account: SpendFromAccount["account"]) {
  const meta = BANK_META[bankKey(account)];
  const logoSrc = bankLogoSrc(meta);
  if (!meta || !logoSrc) return null;
  return { ...accountBrand(account), logoSrc };
}

function LocalBankBadge({ entry, size }: { entry: SpendFromAccount; size: number }) {
  const bank = localBank(entry.account);
  if (!bank) return null;
  return (
    <BankBadge
      logoSrc={bank.logoSrc}
      initials={bank.initials}
      altText=""
      brandBg={bank.background}
      size={size}
    />
  );
}

function ScopeNote({ moveLinked }: { moveLinked: boolean }) {
  return (
    <p className="mt-2 text-[11px] leading-[1.45] text-slate-500 dark:text-slate-400 text-pretty">
      Each figure is for that account only, not your full Safe to Spend.
      {moveLinked ? " The move above is already held back." : ""}
    </p>
  );
}

function NoCurrentAccount({ savingsMove }: { savingsMove: boolean }) {
  return (
    <div data-g115-treatment="no-current" className="mt-2 flex items-start gap-2 text-[12px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">
      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
      <p>
        No current account has room to spend from right now.
        {savingsMove ? " Use the savings move above first." : " Checked account by account, not against your full Safe to Spend."}
      </p>
    </div>
  );
}

function InlinePair({ entries, hidden, moveLinked }: {
  entries: SpendFromAccount[];
  hidden: boolean;
  moveLinked: boolean;
}) {
  return (
    <div data-g115-treatment="inline-pair" className="mt-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.07em] text-slate-400 dark:text-slate-500">Spend from</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2" role="list">
        {entries.map((entry) => {
          const bank = accountBrand(entry.account);
          const hasLocalLogo = localBank(entry.account) != null;
          return (
            <div key={entry.accountId} role="listitem" className="flex min-w-0 items-center gap-1.5">
              {hasLocalLogo && <LocalBankBadge entry={entry} size={18} />}
              <span className="max-w-32 truncate text-[12px] font-medium text-slate-600 dark:text-slate-300">{entry.name}</span>
              {!hasLocalLogo && <span className="text-[10px] text-slate-400 dark:text-slate-500">{bank.label}</span>}
              <span className="money shrink-0 text-[12px] font-semibold text-slate-700 dark:text-slate-200">{money(entry.headroom, hidden)}</span>
            </div>
          );
        })}
      </div>
      <ScopeNote moveLinked={moveLinked} />
    </div>
  );
}

function QuietRows({ entries, hidden, moveLinked }: {
  entries: SpendFromAccount[];
  hidden: boolean;
  moveLinked: boolean;
}) {
  return (
    <div data-g115-treatment="quiet-rows" className="mt-3 border-t border-slate-100 pt-1 dark:border-white/10">
      <p className="sr-only">Accounts with room to spend from</p>
      <dl>
        {entries.map((entry, index) => {
          const bank = accountBrand(entry.account);
          const hasLocalLogo = localBank(entry.account) != null;
          return (
            <div key={entry.accountId} className={`flex min-h-11 items-center gap-2.5 py-2 ${index > 0 ? "border-t border-slate-100 dark:border-white/[0.07]" : ""}`}>
              {hasLocalLogo && <LocalBankBadge entry={entry} size={24} />}
              <dt className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold text-slate-700 dark:text-slate-200">{entry.name}</span>
                <span className="block truncate text-[10px] text-slate-500 dark:text-slate-400">Spend from {bank.label}</span>
              </dt>
              <dd className="text-right">
                <span className="money block text-[12px] font-semibold text-slate-700 dark:text-slate-200">{money(entry.headroom, hidden)}</span>
                <span className="block text-[10px] text-slate-500 dark:text-slate-400">spare there</span>
              </dd>
            </div>
          );
        })}
      </dl>
      <ScopeNote moveLinked={moveLinked} />
    </div>
  );
}

function previewTreatment(variant: Variant, result: SpendFromResult, hidden: boolean, moveLinked: boolean, savingsMove: boolean): {
  heroAside?: ReactNode;
  body: ReactNode;
} | undefined {
  if (variant === "a") return undefined;

  const entries = spendAccounts(result);
  if (entries.length === 0) return { body: <NoCurrentAccount savingsMove={savingsMove} /> };

  if (variant === "b") {
    return { body: <InlinePair entries={entries} hidden={hidden} moveLinked={moveLinked} /> };
  }

  return { body: <QuietRows entries={entries} hidden={hidden} moveLinked={moveLinked} /> };
}

function PreviewControls({ variant, state, mode, query }: {
  variant: Variant;
  state: PreviewState;
  mode: Mode;
  query: (next: Partial<{ variant: Variant; state: PreviewState; mode: Mode }>) => string;
}) {
  return (
    <nav
      aria-label="G115 preview controls"
      className="border-b border-white/10 bg-slate-950 px-3 py-2 text-white"
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-1">
        {(["a", "b", "c"] as Variant[]).map((key) => (
          <a
            key={key}
            href={query({ variant: key })}
            aria-label={`Variant ${key.toUpperCase()}: ${VARIANTS[key].name}`}
            aria-current={key === variant ? "page" : undefined}
            className={`inline-flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-xl px-3 text-xs font-bold [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 active:scale-95 motion-reduce:transform-none ${key === variant ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10"}`}
          >
            {key.toUpperCase()}
          </a>
        ))}
        <label className="flex min-h-11 min-w-0 touch-manipulation items-center gap-1 rounded-xl bg-white/10 px-2 text-xs text-slate-300 focus-within:ring-2 focus-within:ring-indigo-400">
          <span className="sr-only">Preview state</span>
          <select
            value={state}
            name="g115-preview-state"
            autoComplete="off"
            onChange={(event) => window.location.assign(query({ state: event.target.value as PreviewState }))}
            className="max-w-[112px] cursor-pointer bg-slate-800 pr-1 font-semibold text-white outline-none"
          >
            {STATE_ORDER.map((key) => <option key={key} value={key}>{FIXTURES[key].label}</option>)}
          </select>
        </label>
        <a
          href={query({ mode: mode === "dark" ? "light" : "dark" })}
          className="inline-flex min-h-11 touch-manipulation items-center rounded-xl px-2.5 text-xs font-semibold text-slate-300 [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 active:scale-95 hover:bg-white/10 motion-reduce:transform-none"
        >
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </nav>
  );
}

const identityMask = (text: string) => text;
const hiddenMask = (text: string) => text.replace(/(?:−|-)?£[\d,.]+/g, "£••••");

export default function G115SpendFromAccountsClient() {
  const params = useSearchParams();
  const { preferencesReady, setHideNetWorth } = usePreferences();
  const rawVariant = params.get("variant");
  const variant: Variant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const rawState = params.get("state");
  const state: PreviewState = STATE_ORDER.includes(rawState as PreviewState) ? rawState as PreviewState : "reserved";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const fixture = FIXTURES[state];
  const hidden = fixture.hidden;
  const maskAmounts = hidden ? hiddenMask : identityMask;

  useEffect(() => {
    const wasDark = document.documentElement.classList.contains("dark");
    const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
    const previousColorScheme = colorSchemeMeta?.getAttribute("content") ?? null;
    document.documentElement.classList.toggle("dark", mode === "dark");
    colorSchemeMeta?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    return () => {
      document.documentElement.classList.toggle("dark", wasDark);
      if (previousColorScheme == null) colorSchemeMeta?.removeAttribute("content");
      else colorSchemeMeta?.setAttribute("content", previousColorScheme);
    };
  }, [mode]);

  // /design is signed-out and PreferencesProvider owns its state. Intercept
  // only this preview's preference round-trip so the real card's own masking
  // path can be tested without reading or writing a stored user preference.
  useIsomorphicLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const nativeFetch = window.fetch.bind(window);
    const isPreferencesRequest = (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return /\/preferences(?:[/?]|$)/.test(url);
    };
    let version = 0;
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (!isPreferencesRequest(input)) return nativeFetch(input, init);
      version += 1;
      return new Response(JSON.stringify({ hide_net_worth: hidden, version }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof window.fetch;
    return () => {
      window.fetch = nativeFetch;
    };
  }, [hidden]);

  useEffect(() => {
    if (preferencesReady) setHideNetWorth(hidden);
  }, [hidden, preferencesReady, setHideNetWorth]);

  const query = (next: Partial<{ variant: Variant; state: PreviewState; mode: Mode }>) =>
    `?variant=${next.variant ?? variant}&state=${next.state ?? state}&mode=${next.mode ?? mode}`;
  const treatment = previewTreatment(variant, fixture.spendFrom, hidden, fixture.moveLinked, fixture.savingsMove);

  return (
    <div className={`${mode === "dark" ? "dark" : ""} min-h-dvh bg-[#f0f2f7] text-slate-900 selection:bg-indigo-600 selection:text-white dark:bg-[#0f172a] dark:text-slate-100`} style={{ colorScheme: mode }}>
      <a href="#preview" className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-[100] focus-visible:rounded-xl focus-visible:bg-slate-950 focus-visible:px-4 focus-visible:py-3 focus-visible:text-white">Skip to preview</a>
      <PreviewControls variant={variant} state={state} mode={mode} query={query} />

      <main id="preview" className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
        <header className="mb-8">
          <a href="/design" className="inline-flex min-h-11 touch-manipulation items-center gap-1 rounded-lg text-sm font-semibold text-slate-600 [-webkit-tap-highlight-color:transparent] hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400 dark:hover:text-white">
            <ArrowLeft size={16} aria-hidden="true" />
            Design rounds
          </a>
          <h1 className="mt-4 text-balance text-[30px] font-bold tracking-[-0.04em] text-slate-950 dark:text-white">Spend from, without a second hero</h1>
          <p className="mt-2 max-w-[65ch] text-sm leading-6 text-slate-600 dark:text-slate-400">
            {VARIANTS[variant].description} The cover plan and Safe to Spend hero are the real production components, fed typed local fixtures.
          </p>
          <p className="mt-2 max-w-[65ch] text-xs leading-5 text-slate-500 dark:text-slate-500">{fixture.description}</p>
        </header>

        <div className="mx-auto w-full max-w-[520px] space-y-7">
          {fixture.coverPlan && (
            <section id="cover-plan" aria-labelledby="cover-plan-heading">
              <h2 id="cover-plan-heading" className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Today&apos;s brief</h2>
              <MoveCard
                item={fixture.coverPlan}
                hideNetWorth={hidden}
                maskAmounts={maskAmounts}
                previewMode
              />
            </section>
          )}

          <section aria-labelledby="where-you-stand-heading">
            <h2 id="where-you-stand-heading" className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Where you stand</h2>
            <SafeToSpendCard
              data={fixture.safeToSpend}
              loading={false}
              error={false}
              spendFrom={fixture.spendFrom}
              coverMoveVisible={variant === "a" && fixture.coverPlan != null}
              spendFromPreview={treatment}
            />
          </section>
        </div>
      </main>
    </div>
  );
}
