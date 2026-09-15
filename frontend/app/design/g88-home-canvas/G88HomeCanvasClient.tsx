"use client";

// Fixture-only G88 preview: the supporting cards below are the shipped Home
// components, so this route stays a useful visual gate rather than a copy.
import { useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronRight, EyeOff, ShieldCheck } from "lucide-react";
import { AskGenericCard, AskPaydayCard, CelebrationCard, CliffCard, IntentPaceCard, MoveCard, RhythmCard, UnfundedMoveCard } from "@/components/HomeBrief";
import FixtureBottomNav from "../_components/FixtureBottomNav";
import type { ProductionCardFixture } from "../home-brief-cards/productionFixtures";
import { PRODUCTION_CARD_FIXTURES } from "../home-brief-cards/productionFixtures";

type Variant = "a" | "b" | "c";
type State = "calm" | "payday" | "cover" | "pace" | "details" | "good-news" | "mixed" | "error" | "hidden";
type Mode = "light" | "dark";
const variants: Record<Variant, { name: string; summary: string }> = {
  a: { name: "Reading line", summary: "One chronological reading, where a card appears only when it needs a response." },
  b: { name: "Today board", summary: "A practical board that gives each live decision a clear, reachable place." },
  c: { name: "Rhythm", summary: "A pay-period rhythm that separates what is now, what is watched and what has settled." },
};
const states: { key: State; label: string }[] = [
  { key: "calm", label: "Calm, no cards" }, { key: "payday", label: "Payday question" }, { key: "cover", label: "Cover a move" },
  { key: "pace", label: "Pace advice" }, { key: "details", label: "Details needed" }, { key: "good-news", label: "Good news" },
  { key: "mixed", label: "Full mixed family" }, { key: "error", label: "Connection error" }, { key: "hidden", label: "Balances hidden" },
];
const heroCopy: Record<State, { amount: string; status: string; reading: string; detail: string; unavailable?: boolean }> = {
  calm: { amount: "£428", status: "On track", reading: "Bills, plans and your buffer are covered until payday.", detail: "8 days until payday" },
  payday: { amount: "£428", status: "On track", reading: "Your plan is ready. One payday detail would make the next forecast sharper.", detail: "8 days until payday" },
  cover: { amount: "£428", status: "On track", reading: "Cash is covered until payday. A planned card move needs a final check.", detail: "8 days until payday" },
  pace: { amount: "£428", status: "On track", reading: "Your essential plans are covered. There is one pace change worth keeping an eye on.", detail: "8 days until payday" },
  details: { amount: "£428", status: "On track", reading: "You are safe for this period. One detail would keep your card picture accurate.", detail: "8 days until payday" },
  "good-news": { amount: "£428", status: "On track", reading: "Your plan is on pace, and one bill is already safely set aside.", detail: "8 days until payday" },
  mixed: { amount: "£428", status: "On track", reading: "Your essentials are covered. Here is the complete family of things Penny may surface.", detail: "8 days until payday" },
  error: { amount: "Not available", status: "Could not check", reading: "We cannot safely calculate what is free until payday while your accounts refresh.", detail: "Try again after your accounts refresh", unavailable: true },
  hidden: { amount: "£••••", status: "On track", reading: "Your plan is still on pace. Balances stay hidden on this device.", detail: "8 days until payday" },
};
const idsForState: Record<Exclude<State, "calm" | "error" | "hidden">, string[]> = {
  payday: ["ask:payday"], cover: ["unfunded_move:2026-09-12:preview", "plan:2026-09-28:preview"],
  pace: ["intent_pace:2026-08-28:Groceries", "rhythm:checkpoint:2026-08-28:Eating out"], details: ["ask:card_terms", "cliff:american-express:2026-09-30"],
  "good-news": ["celebrate:rent"], mixed: PRODUCTION_CARD_FIXTURES.map(({ item }) => item.id),
};
const cardTitles: Record<State, string> = { calm: "Nothing needs you now", payday: "One question before payday", cover: "Keep this move covered", pace: "Worth watching", details: "One thing to sharpen", "good-news": "A quiet win", mixed: "Everything Penny may surface", error: "We need a fresh account check", hidden: "Your plan, with balances hidden" };

function Money({ children }: { children: string }) { return <span className="font-mono tabular-nums">{children}</span>; }
const hideAmounts = (text: string) => text.replace(/(?:−|-)?£[\d,.]+/g, "£••••");
const noopDismiss = () => {};

function ProductionCard({ fixture, hidden }: { fixture: ProductionCardFixture; hidden: boolean }) {
  const router = useRouter();
  const common = { item: fixture.item, maskAmounts: hidden ? hideAmounts : (text: string) => text, dismissible: true, onHomeDismiss: noopDismiss };
  let card: ReactNode;
  switch (fixture.kind) {
    case "ask_payday": card = <AskPaydayCard {...common} router={router} previewMode />; break;
    case "ask_generic": card = <AskGenericCard {...common} router={router} />; break;
    case "celebration": card = <CelebrationCard {...common} router={router} />; break;
    case "cliff": card = <CliffCard {...common} />; break;
    case "unfunded_move": card = <UnfundedMoveCard {...common} hideNetWorth={hidden} previewMode />; break;
    case "intent_pace": card = <IntentPaceCard {...common} />; break;
    case "cover_plan": card = <MoveCard {...common} hideNetWorth={hidden} previewMode />; break;
    case "rhythm": card = <RhythmCard {...common} router={router} previewMode />; break;
  }
  return <div data-production-card-kind={fixture.kind}>{card}</div>;
}

function PreviewControls({ variant, state, mode, query }: { variant: Variant; state: State; mode: Mode; query: (next: Partial<{ variant: Variant; state: State; mode: Mode }>) => string }) {
  return <nav aria-label="G88 design preview controls" className="fixed inset-x-0 bottom-0 z-[80] border-t border-white/10 bg-slate-950/95 px-3 py-2 text-white shadow-xl lg:left-64" style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))" }}><div className="mx-auto flex max-w-6xl items-center gap-1.5"><div className="flex shrink-0 gap-1">{(["a", "b", "c"] as Variant[]).map((key) => <a key={key} href={query({ variant: key })} aria-label={`Variant ${key.toUpperCase()}: ${variants[key].name}`} aria-current={key === variant ? "page" : undefined} className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 active:scale-95 ${key === variant ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10"}`}>{key.toUpperCase()}</a>)}</div><label className="ml-auto flex min-h-11 min-w-0 items-center rounded-xl bg-white/10 px-2 text-xs text-slate-300 focus-within:ring-2 focus-within:ring-indigo-400"><span className="sr-only">Preview Home card permutation</span><select value={state} onChange={(event) => window.location.assign(query({ state: event.target.value as State }))} className="max-w-[142px] cursor-pointer bg-slate-800 pr-1 font-semibold text-white outline-none">{states.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}</select></label><a href={query({ mode: mode === "dark" ? "light" : "dark" })} className="inline-flex min-h-11 shrink-0 items-center rounded-xl px-3 text-xs font-semibold text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 active:scale-95 hover:bg-white/10">{mode === "dark" ? "Light" : "Dark"}</a></div></nav>;
}

export default function G88HomeCanvasClient() {
  const params = useSearchParams(); const rawVariant = params.get("variant"); const rawState = params.get("state");
  const variant: Variant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const state: State = states.some(({ key }) => key === rawState) ? rawState as State : "calm";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light"; const copy = heroCopy[state]; const hidden = state === "hidden";
  const fixtures = hidden ? PRODUCTION_CARD_FIXTURES.filter(({ kind }) => kind === "cover_plan" || kind === "intent_pace") : state === "calm" || state === "error" ? [] : PRODUCTION_CARD_FIXTURES.filter(({ item }) => idsForState[state as Exclude<State, "calm" | "error" | "hidden">].includes(item.id));
  useEffect(() => { document.documentElement.classList.toggle("dark", mode === "dark"); }, [mode]);
  const query = (next: Partial<{ variant: Variant; state: State; mode: Mode }>) => `?variant=${next.variant ?? variant}&state=${next.state ?? state}&mode=${next.mode ?? mode}`;
  const hero = <section aria-labelledby="safe-heading" className="glass-hero rounded-3xl p-5 shadow-sm sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[.08em] text-slate-500 dark:text-slate-400">Safe to Spend</p><h2 id="safe-heading" className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-300">Available after bills and plans</h2></div>{hidden ? <EyeOff size={19} className="text-slate-500" aria-label="Balances hidden" /> : <ShieldCheck size={20} className="text-slate-500" aria-hidden="true" />}</div><p className={`mt-5 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${copy.unavailable ? "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"}`}>{copy.status}</p>{copy.unavailable ? <p className="mt-4 text-base font-bold text-slate-950 dark:text-white">Your Safe to Spend figure is unavailable</p> : <p className="mt-3 text-[40px] font-bold leading-none tracking-[-.04em] text-slate-950 dark:text-white"><Money>{copy.amount}</Money></p>}<p className="mt-4 max-w-[55ch] text-sm leading-6 text-slate-600 dark:text-slate-300">{copy.reading}</p><a href={copy.unavailable ? query({ state: "calm" }) : "#period"} className="mt-5 inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-95 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-500/10">{copy.unavailable ? "Try again" : "See how we got here"}<ChevronRight size={16} aria-hidden="true" /></a></section>;
  const cards = fixtures.length ? <section aria-labelledby="brief-heading"><div className="mb-4 flex items-end justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[.08em] text-slate-500 dark:text-slate-400">Today&apos;s brief</p><h2 id="brief-heading" className="mt-1 text-base font-bold text-slate-950 dark:text-white">{cardTitles[state]}</h2></div><span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{fixtures.length} {fixtures.length === 1 ? "card" : "cards"}</span></div><div className={variant === "b" && fixtures.length > 1 ? "grid gap-3 lg:grid-cols-2" : "space-y-3"}>{fixtures.map((fixture) => <ProductionCard key={fixture.item.id} fixture={fixture} hidden={hidden} />)}</div></section> : <section aria-labelledby="brief-heading" className="border-t border-slate-200 pt-5 dark:border-slate-700"><p className="text-[11px] font-semibold uppercase tracking-[.08em] text-slate-500 dark:text-slate-400">Today&apos;s brief</p><h2 id="brief-heading" className="mt-1 text-base font-bold text-slate-950 dark:text-white">{cardTitles[state]}</h2><p className="mt-2 max-w-[52ch] text-sm leading-6 text-slate-600 dark:text-slate-400">{copy.unavailable ? "We will not guess while the calculation is incomplete. Try again once your bank refreshes." : "No card is needed. We will keep watching the bills and planned moves already in place."}</p></section>;
  const period = <section id="period" aria-labelledby="period-heading" className="border-t border-slate-200 pt-5 dark:border-slate-700"><div className="flex items-center justify-between gap-4"><h2 id="period-heading" className="text-base font-bold text-slate-950 dark:text-white">This pay period</h2><a href="/spend" className="inline-flex min-h-11 items-center text-sm font-semibold text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">View spend</a></div><dl className="mt-4 grid grid-cols-3 gap-3"><div><dt className="text-[10px] font-semibold uppercase tracking-[.07em] text-slate-500 dark:text-slate-400">In</dt><dd className="mt-1 text-sm font-bold text-slate-950 dark:text-white"><Money>{hidden ? "£••••" : "£2,640"}</Money></dd></div><div><dt className="text-[10px] font-semibold uppercase tracking-[.07em] text-slate-500 dark:text-slate-400">Out</dt><dd className="mt-1 text-sm font-bold text-slate-950 dark:text-white"><Money>{hidden ? "£••••" : "£1,904"}</Money></dd></div><div><dt className="text-[10px] font-semibold uppercase tracking-[.07em] text-slate-500 dark:text-slate-400">Moved</dt><dd className="mt-1 text-sm font-bold text-slate-950 dark:text-white"><Money>{hidden ? "£••••" : "£308"}</Money></dd></div></dl></section>;
  const layout = variant === "b" ? <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,.8fr)]"><div className="space-y-8">{hero}{period}</div><div className="space-y-8 lg:border-l lg:border-slate-200 lg:pl-8 dark:lg:border-slate-700">{cards}</div></div> : variant === "c" ? <div className="mx-auto max-w-2xl space-y-8"><p className="text-sm font-medium text-slate-600 dark:text-slate-400">Monday, 15 September · {copy.detail}</p>{hero}<div className="border-l-2 border-slate-200 pl-5 dark:border-slate-700">{cards}</div>{period}</div> : <div className="mx-auto max-w-2xl space-y-8">{hero}{cards}{period}</div>;
  return <main className={`${mode === "dark" ? "dark" : ""} min-h-dvh bg-[#f0f2f7] text-slate-900 selection:bg-indigo-200 dark:bg-[#0f172a] dark:text-slate-100`} style={{ colorScheme: mode, "--design-controls-clearance": "76px" } as CSSProperties}><a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-slate-950 focus:px-4 focus:py-3 focus:text-white">Skip to preview</a><div className="mx-auto max-w-6xl px-4 pb-60 pt-6 sm:px-6 sm:pt-10 lg:pb-24"><header className="mb-8"><a href="/design" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400"><ArrowLeft size={16} aria-hidden="true" />Design rounds</a><h1 className="mt-4 text-balance text-[30px] font-bold tracking-[-.04em] text-slate-950 dark:text-white">Home, on the canvas</h1><p className="mt-2 max-w-[65ch] text-sm leading-6 text-slate-600 dark:text-slate-400">{variants[variant].summary} Every card below is a real production component, rendered with local fixtures only.</p></header><div id="content">{layout}</div></div><FixtureBottomNav active="Home" /><PreviewControls variant={variant} state={state} mode={mode} query={query} /></main>;
}
