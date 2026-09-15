"use client";

import {useEffect, useState, type ReactNode} from "react";
import {useSearchParams} from "next/navigation";
import {AlertCircle, ArrowLeft, Camera, ChevronDown, ReceiptText, ScanLine} from "lucide-react";

type Variant = "a" | "b" | "c";
type State = "ready" | "empty" | "loading" | "error";

const rows = [
  ["Sainsbury’s", "Today · 12 items", "£42.18"],
  ["Tesco", "Yesterday · 8 items", "£28.64"],
  ["Waitrose", "Mon 8 Sept · 14 items", "£56.10"],
];
const focusRing = "transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-800";

function Capture({queued, onQueue}: {queued: boolean; onQueue: () => void}) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"><div className="flex gap-3"><Camera aria-hidden="true" className="mt-1 shrink-0 text-indigo-600" /><div><h2 className="text-base font-bold">Capture a receipt</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Take a clear photo and Sorted will group the items into one basket for you to check.</p><button type="button" onClick={onQueue} className="mt-3 min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800">{queued ? "Photo ready to check" : "Use camera"}</button></div></div>{queued && <p className="mt-3 border-t pt-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400"><ScanLine aria-hidden="true" size={15} className="mr-1 inline" />Receipt read. Check the extracted basket before saving it.</p>}</section>;
}

function Extraction({queued, confirmed, onConfirm}: {queued: boolean; confirmed: boolean; onConfirm: () => void}) {
  return <section aria-live="polite" className="border-y border-slate-200 py-4 dark:border-slate-700"><h2 className="font-bold">{queued ? "Extracted basket" : "Basket to check"}</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{queued ? "12 items from Sainsbury’s · £42.18" : "A receipt photo creates one grouped basket for you to review."}</p>{queued && <div className="mt-3 flex flex-wrap items-center gap-3"><span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium dark:bg-slate-700">4 cupboard · 5 fresh · 3 household</span><button type="button" onClick={onConfirm} className={`min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold dark:border-slate-600 dark:bg-slate-800 ${focusRing}`}>{confirmed ? "Basket confirmed" : "Confirm basket"}</button></div>}</section>;
}

function PriceInsight({confirmed}: {confirmed: boolean}) {
  return <section className="border-y border-slate-200 py-4 dark:border-slate-700"><h2 className="font-bold">Price insight</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{confirmed ? "Pasta is £0.18 lower than your last basket. This is observed price history, not a saving promise." : "Confirm this basket to compare a price detail with your history."}</p></section>;
}

function History() {
  const [open, setOpen] = useState<string | null>(null);
  return <section><h2 className="text-base font-bold">Receipt history</h2><div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">{rows.map(([shop, when, cost]) => <div key={shop} className="border-b last:border-0 dark:border-slate-700"><button type="button" aria-expanded={open === shop} onClick={() => setOpen(open === shop ? null : shop)} className={`flex min-h-[70px] w-full items-center gap-3 px-4 text-left ${focusRing}`}><ReceiptText aria-hidden="true" className="text-emerald-600" size={18} /><span className="flex-1"><b className="block text-sm">{shop}</b><span className="text-xs text-slate-600 dark:text-slate-400">{when}</span></span><b className="font-mono text-sm">{cost}</b><ChevronDown aria-hidden="true" size={16} /></button>{open === shop && <p className="border-t px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">Basket items are confirmed together for later price comparison.</p>}</div>)}</div></section>;
}

function ReadyStory({variant}: {variant: Variant}) {
  const [queued, setQueued] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const capture = <Capture queued={queued} onQueue={() => { setQueued(true); setConfirmed(false); }} />;
  const extraction = <Extraction queued={queued} confirmed={confirmed} onConfirm={() => setConfirmed(true)} />;
  const insight = <PriceInsight confirmed={confirmed} />;
  if (variant === "b") return <div className="space-y-8 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(18rem,.72fr)] lg:gap-10 lg:space-y-0"><div className="space-y-8">{capture}{extraction}{insight}</div><div className="lg:border-l lg:border-slate-200 lg:pl-8 dark:lg:border-slate-700"><History /></div></div>;
  if (variant === "c") return <div className="space-y-8">{capture}{extraction}{confirmed && <section className="rounded-2xl bg-slate-900 p-5 text-slate-100 dark:bg-slate-800"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-300">After confirmation</p><h2 className="mt-2 text-lg font-bold">One useful change</h2><p className="mt-1 text-sm text-slate-300">Your latest basket cost £13.92 less than the previous one, mostly from fewer branded items.</p></section>}{insight}<History /></div>;
  return <div className="space-y-8">{capture}{extraction}{insight}<History /></div>;
}

export default function G96ReceiptsCanvasClient() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "b" || params.get("variant") === "c" ? params.get("variant") as Variant : "a";
  const state: State = params.get("state") === "empty" || params.get("state") === "loading" || params.get("state") === "error" ? params.get("state") as State : "ready";
  const dark = params.get("mode") === "dark";
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  const controls = <nav aria-label="Receipt preview controls" className="fixed inset-x-0 bottom-3 z-50 flex justify-center px-2"><div className="flex max-w-full overflow-x-auto rounded-2xl bg-slate-900/95 p-1 text-xs shadow-lg">{(["a", "b", "c"] as Variant[]).map(item => <a key={item} aria-current={item === variant ? "page" : undefined} href={`?variant=${item}&state=${state}&mode=${dark ? "dark" : "light"}`} className={`min-h-11 px-3 py-3 text-slate-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${item === variant ? "font-bold text-white" : ""}`}>{item.toUpperCase()}</a>)}<a href={`?variant=${variant}&state=${state}&mode=${dark ? "light" : "dark"}`} className="min-h-11 px-3 py-3 text-slate-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">{dark ? "light" : "dark"}</a></div></nav>;
  let body: ReactNode;
  if (state === "empty") body = <><Capture queued={false} onQueue={() => undefined} /><section className="border-y border-slate-200 py-7 dark:border-slate-700"><h2 className="text-xl font-bold">No receipts yet</h2><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Your first captured receipt will become a basket here.</p></section></>;
  else if (state === "error") body = <><Capture queued={false} onQueue={() => undefined} /><section className="border-y border-slate-200 py-7 dark:border-slate-700"><h2 className="flex gap-2 text-xl font-bold"><AlertCircle aria-hidden="true" />Couldn’t read this receipt</h2><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Try another photo with the full receipt in good light. Existing baskets are safe.</p></section></>;
  else if (state === "loading") body = <div aria-label="Loading receipts" className="space-y-3"><div className="h-28 animate-pulse rounded-2xl bg-slate-200 motion-reduce:animate-none dark:bg-slate-700" /><div className="h-40 animate-pulse rounded-2xl bg-slate-200 motion-reduce:animate-none dark:bg-slate-700" /></div>;
  else body = <ReadyStory variant={variant} />;
  return <div className={`${dark ? "dark" : ""} min-h-dvh bg-[#f0f2f7] pb-32 text-slate-900 dark:bg-[#0f172a] dark:text-slate-100`}><a href="#receipts-story" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:text-slate-900 focus:shadow-lg">Skip to receipt story</a><main id="receipts-story" className="mx-auto max-w-5xl px-4 py-8"><a href="/design" className={`inline-flex min-h-11 items-center gap-1 text-sm ${focusRing}`}><ArrowLeft aria-hidden="true" size={16} />Back to design</a><header className="mt-4 border-b border-slate-200 pb-6 dark:border-slate-700"><h1 className="text-3xl font-bold">Receipts</h1><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Capture, check the basket, then use the history when a price detail matters.</p></header><div className="mt-8">{body}</div><p className="mt-10 text-xs text-slate-600 dark:text-slate-400">Preview only. No receipt is uploaded or changed here.</p></main>{controls}</div>;
}
