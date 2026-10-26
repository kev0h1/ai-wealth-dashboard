"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Info, Star } from "lucide-react";
import AccountsHeader from "@/components/AccountsHeader";
import AccountLedgerRow from "@/components/AccountLedgerRow";
import { BankBadge, accountBrand } from "@/components/AccountMiniCard";
import { SheetFrame } from "@/components/SheetFrame";
import MoneyText from "@/components/MoneyText";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { buildEstate, bankToRow } from "@/lib/accountsEstate";
import { displayAccountName } from "@/lib/accountName";
import { CASES, getFixture, type Case, type Fixture, type FixtureAccount } from "./fixtures";
import { day, money, reading } from "./presentation";

type Variant = "a" | "b";
const control = "min-h-11 touch-manipulation rounded-xl px-3 text-[13px] font-semibold hover:opacity-80 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const muted = "text-[12px] leading-5 text-slate-600 dark:text-slate-300";
const rowFocus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500";

function Status({ item, phase }: { item: FixtureAccount; phase: Fixture["phase"] }) {
  const state = reading(item, phase);
  if (!state.status) return null;
  return <span data-status={state.tone} className="inline-flex items-center gap-1 text-[11px] leading-4 text-slate-600 dark:text-slate-300">
    {state.tone !== "neutral" && <span className={state.tone === "risk" ? "text-rose-700 dark:text-rose-300" : "text-amber-800 dark:text-amber-200"}>{state.tone === "risk" ? <AlertTriangle size={12} aria-hidden="true" /> : <Info size={12} aria-hidden="true" />}</span>}
    {state.status}
  </span>;
}

function Forecast({ item, phase }: { item: FixtureAccount; phase: Fixture["phase"] }) {
  const result = reading(item, phase);
  return <span data-after={item.account.id} className="block text-right text-[14px] font-semibold leading-5 text-slate-900 dark:text-slate-100">
    {result.value === null ? <span className="text-[12px] font-normal text-slate-600 dark:text-slate-300">{result.unavailable}</span> : <MoneyText text={money(result.value)} />}
  </span>;
}

function Identity({ item, pinned }: { item: FixtureAccount; pinned: boolean }) {
  const brand = accountBrand(item.account);
  return <span className="flex min-w-0 items-center gap-2">
    <BankBadge size={28} logoSrc={brand.logoSrc} initials={brand.initials} altText="" brandBg={brand.background} />
    <span className="min-w-0 break-words">
      <span className="block text-[14px] font-semibold leading-5 text-slate-900 dark:text-slate-100">{pinned && <Star size={10} aria-hidden="true" className="mr-1 inline fill-current text-slate-500 dark:text-slate-400" />}{displayAccountName(item.account.name)}</span>
      <span className="block text-[12px] leading-5 text-slate-600 dark:text-slate-300">{brand.label}{item.position?.estimated ? " · source inferred" : ""}</span>
    </span>
  </span>;
}

function PairGroup({ title, items, variant, fixture, onSelect, subtotal }: { title: string; items: FixtureAccount[]; variant: Variant; fixture: Fixture; onSelect: (item: FixtureAccount, element: HTMLElement) => void; subtotal?: number }) {
  return <section data-account-group={title} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none" aria-label={title}>
    <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-3">
      <div><h2 className="text-[15px] font-bold">{title}</h2><p className={muted}>{items.length} accounts{typeof subtotal === "number" ? " · bank balance total" : ""}</p></div>
      {typeof subtotal === "number" && <p className="text-[16px] font-semibold"><MoneyText text={money(subtotal)} /></p>}
    </div>
    {variant === "a" && <div className="grid grid-cols-[minmax(0,1fr)_70px_82px] max-[360px]:grid-cols-2 items-end gap-2 px-4 pb-2 text-right text-[10px] font-medium leading-4 text-slate-600 dark:text-slate-300" aria-hidden="true"><span className="max-[360px]:hidden" /><span>Bank<br />balance</span><span>After payments<br />and plans</span></div>}
    <div className="divide-y divide-slate-100 dark:divide-slate-700">
      {items.map(item => <button key={item.account.id} type="button" data-position-account={item.account.id} onClick={event => onSelect(item, event.currentTarget)} className={`w-full px-4 py-3 text-left hover:bg-slate-50 active:opacity-70 dark:hover:bg-slate-700/40 ${rowFocus}`}>
        {variant === "a" ? <span className="grid grid-cols-[minmax(0,1fr)_70px_82px] max-[360px]:grid-cols-2 items-center gap-2">
          <span className="min-w-0 max-[360px]:col-span-2"><Identity item={item} pinned={fixture.pinnedIds.includes(item.account.id)} /></span>
          <span className="text-right text-[14px] font-medium"><span className="sr-only">Bank balance </span><MoneyText text={money(item.account.balance)} /></span>
          <span className="min-w-0"><span className="sr-only">After payments and plans </span><Forecast item={item} phase={fixture.phase} /><Status item={item} phase={fixture.phase} /></span>
        </span> : <span className="block">
          <span className="flex items-center justify-between gap-3"><Identity item={item} pinned={fixture.pinnedIds.includes(item.account.id)} /><span className="shrink-0 text-right"><span className="block text-[10px] text-slate-600 dark:text-slate-300">Bank balance</span><span className="text-[16px] font-semibold"><MoneyText text={money(item.account.balance)} /></span></span></span>
          <span className="ml-9 mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[12px] leading-5"><span className="text-slate-600 dark:text-slate-300">After payments and plans</span><Forecast item={item} phase={fixture.phase} /></span>
          <span className="ml-9 block text-right"><Status item={item} phase={fixture.phase} /></span>
        </span>}
        <span className="sr-only">View this account’s upcoming payments and plans</span>
      </button>)}
    </div>
  </section>;
}

function AccountWorking({ item, fixture, onClose }: { item: FixtureAccount; fixture: Fixture; onClose: () => void }) {
  const result = reading(item, fixture.phase), p = item.position;
  const line = (label: string, value: number | null, total = false) => <div className={`flex items-baseline justify-between gap-4 py-2 ${total ? "border-t border-slate-300 font-semibold dark:border-slate-600" : ""}`}><dt className="text-[13px]">{label}</dt><dd className="shrink-0 text-right text-[14px]">{value === null ? "Not available" : <MoneyText text={money(value)} />}</dd></div>;
  return <SheetFrame title={displayAccountName(item.account.name)} description={`Upcoming until ${day(fixture.payday)} · estimated`} onClose={onClose} manageHistory={false}>
    <div data-account-working={item.account.id} className="space-y-4 text-slate-900 dark:text-slate-100">
      <div><p className={muted}>Bank balance now</p><p className="mt-1 text-[24px] font-bold"><MoneyText text={money(item.account.balance)} /></p></div>
      {item.account.include_in_safe_to_spend === false ? <p className={muted}>This account is not counted towards Left to spend, so no forecast is shown here.</p> : fixture.phase === "loading" ? <p role="status" className={muted}>Checking the account’s upcoming payments and plans…</p> : !p || p.uncertain ? <p className={muted}>The combined estimate is not available. Payments and plans could not all be checked together.</p> : <>
        <section><h3 className="text-[14px] font-semibold">Payments and income</h3>{item.events.filter(e=>e.kind!=="plan").length ? <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-700">{item.events.filter(e=>e.kind!=="plan").map(event=><li key={event.id} className="flex items-center justify-between gap-4 py-2"><span className="min-w-0 text-[13px]">{event.label}<span className={`block ${muted}`}>{day(event.date)}</span></span><span className="shrink-0 text-[14px]"><MoneyText text={`${event.kind==="income"?"+":"−"}${money(event.amount)}`} /></span></li>)}</ul> : <p className={`mt-2 ${muted}`}>No upcoming payments or income in this forecast.</p>}</section>
        <section><h3 className="text-[14px] font-semibold">Plans from this account</h3>{item.events.filter(e=>e.kind==="plan").length ? <ul className="mt-2 space-y-2">{item.events.filter(e=>e.kind==="plan").map(event=><li key={event.id} className="flex items-baseline justify-between gap-4 text-[13px]"><span>{event.label}</span><MoneyText text={money(event.amount)} /></li>)}</ul> : <p className={`mt-2 ${muted}`}>No plans assigned to this account.</p>}</section>
        <dl>{line("After payments",p.after_payments??null)}{line("Plans still reserved",-(p.plans_reserved??0))}{line("After payments and plans",result.value,true)}</dl>
        <p className={muted}>Only plans paid from this account are included. Plans without a source stay in the shared forecast.</p>
        {p.estimated && <p className={muted}>The plan source is estimated from recent transfers.</p>}
        <section className="border-t border-slate-200 pt-3 dark:border-slate-700"><h3 className="text-[14px] font-semibold">Why Spend from can be lower</h3><dl>{line("Lowest balance after plans",p.low_point_and_plans??null)}{line("Account limit used by Spend from",p.spend_from_headroom??null)}</dl><p className={muted}>That limit also protects the earlier low point, allows for any move held back and cannot exceed the shared estimate. It is a different reading from the balance projected at payday.</p></section>
      </>}
      <Status item={item} phase={fixture.phase} />
      <p className={muted}>An estimate from known payments and assigned plans. It does not count pending payments or bills Sorted has not learned.</p>
    </div>
  </SheetFrame>;
}

export default function BalanceAfterClient() {
  const params=useSearchParams();
  const [variant,setVariant]=useState<Variant>(params.get("variant")==="b"?"b":"a");
  const [which,setWhich]=useState<Case>(CASES.some(c=>c.value===params.get("state"))?params.get("state") as Case:"mixed");
  const [surface,setSurface]=useState(params.get("surface")==="home"?"home":"accounts");
  const [dark,setDark]=useState(params.get("mode")!=="light"),[hidden,setHidden]=useState(params.get("hidden")==="1");
  const [selected,setSelected]=useState<string|null>(null),[notice,setNotice]=useState("");
  const trigger=useRef<HTMLElement|null>(null);
  useEffect(()=>{const old=document.documentElement.classList.contains("dark");document.documentElement.classList.toggle("dark",dark);return()=>{document.documentElement.classList.toggle("dark",old);};},[dark]);
  useEffect(()=>{const query=new URLSearchParams({variant,state:which,surface,mode:dark?"dark":"light",hidden:hidden?"1":"0"});window.history.replaceState(null,"",`${location.pathname}?${query}`);},[variant,which,surface,dark,hidden]);
  const fixture=getFixture(which),estate=buildEstate([...fixture.current.map(i=>i.account),...fixture.other],[],fixture.pinnedIds);
  const select=(item:FixtureAccount,element:HTMLElement)=>{trigger.current=element;setSelected(item.account.id);};
  const close=()=>{setSelected(null);requestAnimationFrame(()=>trigger.current?.focus());};
  const selectedItem=fixture.current.find(i=>i.account.id===selected);
  const pinned=fixture.current.filter(i=>fixture.pinnedIds.includes(i.account.id));
  const currentTotal=estate.groups.find(g=>g.kind==="Current")?.subtotal??0;
  return <main className="min-h-screen bg-[#f0f2f7] px-4 py-5 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
    <div className="mx-auto max-w-6xl">
      <p className="text-xl font-bold">Balances, with the next payments in view</p><p className={`mt-2 ${muted}`}>G339 · Fictional data. Two proposed row layouts, including the Home estate. Production is unchanged.</p>
      <div className="mt-4 flex flex-wrap gap-2">{(["a","b"] as const).map(v=><button key={v} type="button" aria-pressed={variant===v} onClick={()=>setVariant(v)} className={`${control} ${variant===v?"bg-indigo-600 text-white":"border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800"}`}>{v==="a"?"A · Paired columns":"B · Forecast subline"}</button>)}{(["accounts","home"] as const).map(s=><button key={s} type="button" aria-pressed={surface===s} onClick={()=>setSurface(s)} className={`${control} border ${surface===s?"border-indigo-500 text-indigo-700 dark:text-indigo-300":"border-slate-300 dark:border-slate-600"}`}>{s==="accounts"?"Accounts":"Home estate"}</button>)}</div>
      <div className="mt-3 flex flex-wrap items-end gap-2"><label className="grid gap-1 text-[12px] text-slate-600 dark:text-slate-300">Example<select name="case" value={which} onChange={e=>{setWhich(e.target.value as Case);setSelected(null);}} className="min-h-11 max-w-full rounded-xl border border-slate-300 bg-white px-3 text-[14px] text-slate-900 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">{CASES.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select></label><button type="button" onClick={()=>setDark(!dark)} className={`${control} border border-slate-300 dark:border-slate-600`}>{dark?"Light theme":"Dark theme"}</button><button type="button" aria-pressed={hidden} onClick={()=>setHidden(!hidden)} className={`${control} border border-slate-300 dark:border-slate-600`}>{hidden?"Show balances":"Hide balances"}</button></div>
      <BalancesHiddenContext.Provider value={hidden}>
        <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,.8fr)]">
          <div data-g339-surface={surface} className="min-w-0 space-y-3">
            {surface==="accounts"?<AccountsHeader netWorth={{value:estate.netWorth,accountCount:estate.rows.length}} hidden={hidden} showChip={hidden} onShow={()=>setHidden(false)} onAdd={()=>setNotice("This preview does not add or change bank accounts.")} updated="Updated 8 min ago"/>:<h1 className="text-xl font-bold">Your estate</h1>}
            {notice&&<p role="status" className={muted}>{notice}</p>}
            {which==="pence"&&surface==="accounts"&&<p className={muted}>Net worth above is rounded to the nearest pound.</p>}
            <p className={muted}>{fixture.phase==="stale"?"Last known estimate":"Estimated"} · until {day(fixture.payday)}. Known payments, expected income and plans from each account.</p>
            {fixture.phase==="stale"&&<p className={muted}>As of 26 Oct, 07:10. Current checks are not available.</p>}
            {surface==="accounts"?<>
              <PairGroup title="Pinned" items={pinned} variant={variant} fixture={fixture} onSelect={select}/>
              <PairGroup title="Current" items={fixture.current} subtotal={currentTotal} variant={variant} fixture={fixture} onSelect={select}/>
              {fixture.other.map(account=><section key={account.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"><h2 className="px-4 pt-3 text-[15px] font-bold">{account.type==="Savings"?"Savings":"Credit cards"}</h2><AccountLedgerRow row={bankToRow(account,[])} hideAmount={hidden} onClick={()=>setNotice("This proposal adds the second reading to current accounts only.")}/></section>)}
            </>:<><PairGroup title="Your accounts" items={[...pinned,fixture.current[3]]} variant={variant} fixture={fixture} onSelect={select}/><button type="button" onClick={()=>setSurface("accounts")} className={`${control} w-full text-slate-600 dark:text-slate-300`}>All {estate.rows.length} accounts</button></>}
          </div>
          <section aria-label="Design decisions" className={`space-y-3 ${muted}`}>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{variant==="a"?"Compare both readings by column":"Keep the balance row, add one reading"}</h2>
            <p>{variant==="a"?"Two labelled columns make the bank balance and payday estimate easy to compare down the list. Long account names wrap.":"The familiar bank balance stays at the right. A full-width line below names what remains after payments and plans."}</p>
            <p>The group total remains the bank balance total. Pinned duplicates are not added to net worth again. No combined forecast subtotal is invented.</p>
            <p>The second figure is the server’s after-payments-and-plans balance. It includes expected income and plans attributed to this account. Unassigned plans and the shared buffer are not deducted here.</p>
            <p>Spend from can be lower because it protects the account’s earlier low point, a reserved move and the shared cash limit. Tap a row to see that distinction and its own upcoming items.</p>
            <p>Payment gaps use a small risk icon. Plans-only gaps use a small caution icon. Figures keep their minus signs in ink. Missing or uncertain positions have no invented number, and last-known figures have no live warning colour.</p>
            <p>Savings and credit cards keep their existing balance rows in this round. The new comparison applies to current accounts, including their pinned and Home appearances.</p>
            <p className="border-t border-slate-200 pt-3 dark:border-slate-700">The header, bank badges, unchanged non-current rows and sheet frame are production components. Paired rows and account working are coded proposals with API-shaped fixtures. The exact-account Upcoming flow is stateful today; production needs an explicit handoff, not an invented deep-link parameter.</p>
          </section>
        </div>
        {selectedItem&&<AccountWorking item={selectedItem} fixture={fixture} onClose={close}/>}
      </BalancesHiddenContext.Provider>
    </div>
  </main>;
}
