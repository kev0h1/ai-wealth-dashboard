"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BankBadge, accountBrand } from "@/components/AccountMiniCard";
import { DisclosureSummary } from "@/components/Disclosure";
import MoneyText from "@/components/MoneyText";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { displayAccountName } from "@/lib/accountName";
import { bestSpendAccount, spendFromCombinedLine, spendFromIsCombined, type SpendFromAccount } from "@/lib/spendFromAccount";
import { accountListModel } from "./model";
import { fixture, SCENARIOS, type Scenario } from "./fixtures";

const control = "min-h-11 touch-manipulation rounded-xl px-3 text-[13px] font-semibold hover:opacity-80 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none";
const muted = "text-[12px] leading-5 text-slate-600 dark:text-slate-300";
const format = (n: number) => `£${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
type Variant = "a" | "b" | "c" | "d" | "current";
const variantLabels: Record<Variant, string> = { a: "A · Two at a glance", b: "B · All with room", c: "C · Details in the note", d: "D · Details below the card", current: "Current card" };
const LIMITS_NOTE = "Separate account limits, not amounts to add together.";

function AccountRows({ entries, allEntries, pool, combined, reserve }: { entries: SpendFromAccount[]; allEntries: SpendFromAccount[]; pool: number; combined: boolean; reserve: boolean }) {
  return <ul className="space-y-2" aria-label="Account limits">
    {entries.map(entry => {
      const brand = accountBrand(entry.account);
      const sameBank = allEntries.filter(e => accountBrand(e.account).label === brand.label).length > 1;
      const showLimit = !combined && Math.round(entry.headroom) < Math.round(pool);
      return <li key={entry.accountId} data-account={entry.accountId} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2">
        <BankBadge size={24} logoSrc={brand.logoSrc} initials={brand.initials} altText="" brandBg={brand.background} />
        <span className="min-w-0 break-words text-[12px] leading-5 text-slate-700 dark:text-slate-200">
          <span className="block font-medium">{brand.label}</span>
          {sameBank && <span className="block text-slate-600 dark:text-slate-300">{displayAccountName(entry.name)}</span>}
        </span>
        {showLimit && <span data-account-limit className={`${muted} whitespace-nowrap text-right`}>up to <MoneyText text={format(entry.headroom)} /></span>}
        {reserve && entry.accountId === "natwest" && <p className={`col-span-2 col-start-2 mt-1 ${muted}`}><MoneyText text="£20 already held back in NatWest for the move to HSBC." /></p>}
      </li>;
    })}
  </ul>;
}

function AccountTreatment({ scenario, variant }: { scenario: Scenario; variant: "a" | "b" }) {
  const { accounts, eligibility, pool } = fixture(scenario);
  const model = accountListModel(accounts, eligibility, variant);
  const allUsable = [...model.visible, ...model.others.flatMap(e => e.limit ? [e.limit] : [])];
  // Include expanded positive accounts in the shared-total rule as well.
  const combined = spendFromIsCombined(allUsable, pool);
  return <section className="mt-4" data-g325-accounts aria-label="Accounts with room towards this estimate">
    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Spend from</h3>
    <AccountRows entries={model.visible} allEntries={allUsable} pool={pool} combined={combined} reserve={scenario === "move"} />
    {combined ? <p data-combined className={`mt-3 ${muted}`}><MoneyText text={spendFromCombinedLine(allUsable, pool, format, e => accountBrand(e.account).label)} /></p>
      : model.visible.length === 1 && model.visible[0].headroom >= pool ? <p className={`mt-2 ${muted}`}>Within the estimate above.</p> : null}
    <p className={`mt-3 ${muted}`}>
      {model.hasOtherRoom ? "More account limits are shown below. " : ""}
      Separate account limits, not amounts to add together.
    </p>
    {!combined && <p data-limits-explanation className={`mt-2 ${muted}`}>Limits use each account’s lowest cash after payments and plans. Their total may be below the shared estimate.</p>}
    {model.others.length > 0 && <details key={`${scenario}-${variant}`} data-other-accounts className="mt-2 border-t border-slate-100 dark:border-slate-700">
      <DisclosureSummary className={`${control} cursor-pointer px-0 text-slate-700 dark:text-slate-200`}>
        <span>Show other accounts <span className="font-normal text-slate-600 dark:text-slate-300">({model.others.length})</span></span>
      </DisclosureSummary>
      <div className="space-y-3 pb-2 pt-1">
        {model.others.map(other => other.limit
          ? <AccountRows key={other.account.id} entries={[other.limit]} allEntries={allUsable} pool={pool} combined={combined} reserve={scenario === "move"} />
          : <div key={other.account.id} data-other-account={other.account.id} className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-2">
              <BankBadge size={24} logoSrc={accountBrand(other.account).logoSrc} initials={accountBrand(other.account).initials} altText="" brandBg={accountBrand(other.account).background} />
              <div className="min-w-0 break-words">
                <p className="text-[12px] font-medium leading-5 text-slate-700 dark:text-slate-200">{accountBrand(other.account).label}</p>
                {accounts.filter(a => accountBrand(a).label === accountBrand(other.account).label).length > 1 && <p className={muted}>{displayAccountName(other.account.name)}</p>}
                <p className={muted}>{other.reason}</p>
              </div>
            </div>)}
      </div>
    </details>}
  </section>;
}

function AccountWorking({ scenario }: { scenario: Scenario }) {
  const { accounts, eligibility, pool } = fixture(scenario);
  const model = accountListModel(accounts, eligibility, "a");
  const allUsable = [...model.visible, ...model.others.flatMap(e => e.limit ? [e.limit] : [])];
  const combined = spendFromIsCombined(allUsable, pool);
  return <div data-g325-account-working className={`space-y-3 pb-3 pt-2 ${muted}`}>
    <p>The headline checks all counted accounts together. Each account limit also uses that account’s own lowest cash after payments and plans, so the limits need not add up to the headline.</p>
    {model.hasOtherRoom && <p>Only the two highest account limits are shown on the card.</p>}
    {model.others.length > 0 && <>
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Other current accounts</h4>
      <div className="space-y-3">
        {model.others.map(other => other.limit ? <AccountRows key={other.account.id} entries={[other.limit]} allEntries={allUsable} pool={pool} combined={combined} reserve={scenario === "move"} /> : <div key={other.account.id} data-other-account={other.account.id} className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-2">
          <BankBadge size={24} logoSrc={accountBrand(other.account).logoSrc} initials={accountBrand(other.account).initials} altText="" brandBg={accountBrand(other.account).background} />
          <div className="min-w-0 break-words"><p className="font-medium text-slate-700 dark:text-slate-200">{accountBrand(other.account).label}</p><p>{other.reason}</p></div>
        </div>)}
      </div>
    </>}
  </div>;
}

function CompactAccountTreatment({ scenario, variant }: { scenario: Scenario; variant: "c" | "d" }) {
  const { accounts, eligibility, pool } = fixture(scenario);
  const model = accountListModel(accounts, eligibility, "a");
  const allUsable = [...model.visible, ...model.others.flatMap(e => e.limit ? [e.limit] : [])];
  const combined = spendFromIsCombined(allUsable, pool);
  return <section data-g325-accounts data-g325-compact={variant} aria-label="Accounts with room towards this estimate" className="mt-4">
    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Spend from</h3>
    <AccountRows entries={model.visible} allEntries={allUsable} pool={pool} combined={combined} reserve={scenario === "move"} />
    {combined && <p data-combined className={`mt-3 ${muted}`}><MoneyText text={spendFromCombinedLine(allUsable, pool, format, e => accountBrand(e.account).label)} /></p>}
    {model.visible.length === 1 && model.visible[0].headroom >= pool && <p className={`mt-2 ${muted}`}>Within the estimate above.</p>}
    {variant === "c" && model.others.length > 0 ? <details key={scenario} data-g325-compact-note className="mt-3">
      <DisclosureSummary className={`min-h-11 cursor-pointer rounded-lg text-left font-normal active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${muted}`}><span>{LIMITS_NOTE}</span></DisclosureSummary>
      <AccountWorking scenario={scenario} />
    </details> : <p className={`mt-3 ${muted}`}>{LIMITS_NOTE}</p>}
  </section>;
}

function OutsideWorking({ scenario }: { scenario: Scenario }) {
  const f = fixture(scenario), model = accountListModel(f.accounts, f.eligibility, "a");
  if (model.others.length === 0) return null;
  return <details key={scenario} data-g325-outside-working className="border-b border-slate-200 dark:border-slate-700">
    <DisclosureSummary className="min-h-11 cursor-pointer rounded-lg text-[13px] font-medium text-slate-700 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200">{model.others.length > 0 ? "Other accounts and limits" : "About account limits"}</DisclosureSummary>
    <AccountWorking scenario={scenario} />
  </details>;
}

export default function SpendFromAccountsClient() {
  const params = useSearchParams();
  const [variant, setVariant] = useState<Variant>(["a", "b", "c", "d", "current"].includes(params.get("variant") ?? "") ? params.get("variant") as Variant : "c");
  const [scenario, setScenario] = useState<Scenario>(SCENARIOS.some(s => s.value === params.get("state")) ? params.get("state") as Scenario : "current");
  const [dark, setDark] = useState(params.get("mode") !== "light");
  const [hidden, setHidden] = useState(params.get("hidden") === "1");
  useEffect(() => {
    const old = document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    return () => { document.documentElement.classList.toggle("dark", old); };
  }, [dark]);
  useEffect(() => {
    const query = new URLSearchParams({ variant, state: scenario, mode: dark ? "dark" : "light", hidden: hidden ? "1" : "0" });
    window.history.replaceState(null, "", `${window.location.pathname}?${query}`);
  }, [variant, scenario, dark, hidden]);
  const { accounts, eligibility, data } = fixture(scenario);
  return <main className="min-h-screen bg-[#f0f2f7] px-4 py-5 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
    <a href="#g325-proposal" className="sr-only rounded-lg bg-white p-3 text-indigo-700 focus:not-sr-only focus:outline-2 focus:outline-indigo-500 dark:bg-slate-800 dark:text-indigo-300">Skip to the proposal</a>
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-bold">Keep the card compact</h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-5 text-slate-600 dark:text-slate-300">G325 revision · Same hero and action row, with account details kept quiet. Rows still follow the cash checks. Fictional figures, no production changes.</p>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Design options">
        {(["c", "d", "current"] as const).map(v => <button key={v} type="button" aria-pressed={variant === v} onClick={() => setVariant(v)} className={`${control} ${variant === v ? "bg-indigo-600 text-white" : "border border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"}`}>{variantLabels[v]}</button>)}
      </div>
      <details className="mt-2"><DisclosureSummary className={`${control} cursor-pointer px-0 text-slate-600 dark:text-slate-300`}>Previous designs</DisclosureSummary><div className="flex flex-wrap gap-2 py-2">{(["a", "b"] as const).map(v => <button key={v} type="button" aria-pressed={variant === v} onClick={() => setVariant(v)} className={`${control} ${variant === v ? "bg-indigo-600 text-white" : "border border-slate-300 dark:border-slate-600"}`}>{variantLabels[v]}</button>)}</div></details>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-[12px] text-slate-600 dark:text-slate-300">Example
          <select name="example" value={scenario} onChange={e => setScenario(e.target.value as Scenario)} className="min-h-11 max-w-full rounded-xl border border-slate-300 bg-white px-3 text-[14px] text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            {SCENARIOS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setDark(!dark)} className={`${control} border border-slate-300 dark:border-slate-600`}>{dark ? "Light theme" : "Dark theme"}</button>
        <button type="button" aria-pressed={hidden} onClick={() => setHidden(!hidden)} className={`${control} border border-slate-300 dark:border-slate-600`}>{hidden ? "Show figures" : "Hide figures"}</button>
      </div>
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div id="g325-proposal" tabIndex={-1} className="min-w-0 scroll-mt-5" data-proposal>
          {scenario === "move" && <p className={`mb-3 ${muted}`}><MoneyText text={hidden ? "Move shown above: £•••• from NatWest to HSBC. Already allowed for in the account limit." : "Move shown above: £20 from NatWest to HSBC. Already allowed for in the account limit."} /></p>}
          <BalancesHiddenContext.Provider value={hidden}>
            <SafeToSpendCard data={data} previewBalancesVisible={!hidden} spendFrom={bestSpendAccount(eligibility, accounts)} spendFromPreview={variant === "current" ? undefined : { hideBalances: hidden, body: variant === "a" || variant === "b" ? <AccountTreatment scenario={scenario} variant={variant} /> : <CompactAccountTreatment scenario={scenario} variant={variant} /> }} />
            {variant === "d" && <OutsideWorking scenario={scenario} />}
          </BalancesHiddenContext.Provider>
        </div>
        <section aria-label="About these proposals" className="space-y-3 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{variant === "c" ? "The note is the disclosure" : variant === "d" ? "The card keeps its current height" : variant === "current" ? "Current production layout" : "Earlier round"}</h2>
          <p>{variant === "c" ? "The existing limits note opens the explanation and other account checks. No extra paragraph or new disclosure row inside the closed card." : variant === "d" ? "The account rows, plain limits note and action dock stay in their current arrangement. Other accounts and the explanation sit below the existing calculation and card-activity disclosures." : variant === "current" ? "This renders the current production account list, for direct comparison using the same fictional inputs." : "These are the earlier, taller proposals retained for comparison."}</p>
          <p>Favourites do not choose these rows. The same account checks and ranking still identify the two current accounts with the most room.</p>
          <p>The heading is a label. Rows report an account limit; they do not instruct a payment or move money.</p>
          <h2 className="pt-2 text-base font-bold text-slate-900 dark:text-slate-100">Why the figures can differ</h2>
          <p>Today’s list returns only two accounts. Its limits also use each account’s own lowest forecast point. The headline uses the combined forecast, then deducts the shared buffer and reserves.</p>
          <p>The examples distinguish an omitted positive account from a genuine difference in payment timing. Neither invents an account holding the difference.</p>
          <p>In “Different payment timing”, two accounts pay out before receiving money back. Another pays later. Their individual lows occur at different times, so adding those lows does not reproduce the combined low.</p>
          <p className="border-t border-slate-200 pt-3 text-[12px] dark:border-slate-700">The hero and its working use the production component with fictional inputs. The proposed account list is local to this round. No banking requests or saved preference changes.</p>
        </section>
      </div>
    </div>
  </main>;
}
