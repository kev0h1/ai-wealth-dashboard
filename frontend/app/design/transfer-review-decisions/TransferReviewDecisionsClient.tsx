"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, Check, ChevronDown, CircleHelp, CreditCard, Landmark, PiggyBank, ReceiptText, RotateCw, ShieldCheck, X } from "lucide-react";
import { useSearchParams } from "next/navigation";

type Variant = "a" | "b";
type FixtureState = "ready" | "loading" | "empty" | "error";
type ReviewId = "pair" | "barclays-single" | "monzo-single" | "starling-single";
type Choice = "transfer" | "savings" | "card" | "spending";

const choices: { key: Choice; label: string; detail: string; Icon: typeof Landmark }[] = [
  { key: "transfer", label: "Another of my accounts", detail: "Money moved between your own accounts", Icon: Landmark },
  { key: "savings", label: "Savings or investments", detail: "Money you put aside", Icon: PiggyBank },
  { key: "card", label: "Paying off a card", detail: "A payment to one of your cards", Icon: CreditCard },
  { key: "spending", label: "Spending", detail: "Something you bought", Icon: ReceiptText },
];

const button = "inline-flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-[0.98]";

function money(value: string, hidden: boolean) {
  return hidden ? (value.startsWith("−") ? "−£•••" : value.startsWith("+") ? "+£•••" : "£•••") : value;
}

function PreviewControls({ variant, state, dark, hidden }: { variant: Variant; state: FixtureState; dark: boolean; hidden: boolean }) {
  const href = (next: Partial<{ variant: Variant; state: FixtureState; mode: "light" | "dark"; hidden: "1" }>) => {
    const values = new URLSearchParams({ variant, state, mode: dark ? "dark" : "light" });
    if (hidden) values.set("hidden", "1");
    if (next.variant) values.set("variant", next.variant);
    if (next.state) values.set("state", next.state);
    if (next.mode) values.set("mode", next.mode);
    if (next.hidden) values.set("hidden", next.hidden);
    if (next.hidden === undefined && "hidden" in next) values.delete("hidden");
    return `?${values.toString()}`;
  };
  return <nav aria-label="Transfer review preview controls" className="mt-5 flex flex-wrap gap-2">
    {(["a", "b"] as Variant[]).map((value) => <a key={value} href={href({ variant: value })} aria-current={value === variant ? "page" : undefined} className={`${button} ${value === variant ? "bg-indigo-600 text-white" : "border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>{value === "a" ? "A · Decide as you go" : "B · Check the match"}</a>)}
    {(["ready", "loading", "empty", "error"] as FixtureState[]).map((value) => <a key={value} href={href({ state: value })} aria-current={value === state ? "page" : undefined} className={`${button} px-2.5 text-xs ${value === state ? "bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-white" : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"}`}>{value === "ready" ? "Review" : value === "loading" ? "Loading" : value[0].toUpperCase() + value.slice(1)}</a>)}
    <a href={href({ hidden: hidden ? undefined : "1" })} className={`${button} border border-slate-200 bg-white text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200`}>{hidden ? "Show amounts" : "Hide amounts"}</a>
    <a href={href({ mode: dark ? "light" : "dark" })} className={`${button} border border-slate-200 bg-white text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200`}>{dark ? "Light" : "Dark"}</a>
  </nav>;
}

function ChoiceButtons({ onChoose }: { onChoose: (choice: Choice) => void }) {
  return <div className="mt-3 grid gap-2 sm:grid-cols-2">
    {choices.map(({ key, label, detail, Icon }) => <button key={key} type="button" onClick={() => onChoose(key)} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-indigo-200 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-indigo-400/50 dark:hover:bg-indigo-400/10">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><Icon size={16} aria-hidden="true" /></span>
      <span className="min-w-0"><span className="block text-sm font-semibold text-slate-900 dark:text-white">{label}</span><span className="block text-xs leading-4 text-slate-500 dark:text-slate-400">{detail}</span></span>
    </button>)}
  </div>;
}

function Leg({ account, detail, amount, hidden, positive = false }: { account: string; detail: string; amount: string; hidden: boolean; positive?: boolean }) {
  return <div className="flex items-center gap-3 py-2"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><Landmark size={15} aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-900 dark:text-white">{account}</span><span className="block truncate text-xs text-slate-500 dark:text-slate-400">{detail}</span></span><span aria-label={hidden ? "Amount hidden" : undefined} className={`shrink-0 font-mono text-sm font-bold tabular-nums ${positive ? "text-emerald-700 dark:text-emerald-300" : "text-slate-900 dark:text-white"}`}>{money(amount, hidden)}</span></div>;
}

function PairCandidate({ hidden, onResolve, variant }: { hidden: boolean; onResolve: (ids: ReviewId[], message: string, keepCredit?: boolean) => void; variant: Variant }) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [showPairCheck, setShowPairCheck] = useState(variant === "b");
  const [separate, setSeparate] = useState(false);
  useEffect(() => { setChoice(null); setShowPairCheck(variant === "b"); }, [variant]);
  const choiceLabel = choices.find(item => item.key === choice)?.label;

  return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
    <div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300"><CircleHelp size={18} aria-hidden="true" /></span><div className="min-w-0 flex-1"><h3 className="text-base font-bold tracking-[-0.015em] text-slate-950 dark:text-white">This could be one transfer</h3><p className="mt-0.5 text-sm leading-5 text-slate-600 dark:text-slate-300">The amount and timing match. It is not confirmed yet.</p></div></div>
    <div className="mt-3 divide-y divide-slate-100 border-y border-slate-100 dark:divide-slate-800 dark:border-slate-800"><Leg account="Premier Current Account" detail="Barclays · 27 Feb · KEVIN MAINGI STARLING STO" amount="−£75.53" hidden={hidden} /><Leg account="Personal" detail="Starling · 28 Feb · transfer received" amount="+£75.53" hidden={hidden} positive /></div>
    {showPairCheck ? <div className="mt-3"><p className="text-sm font-semibold text-slate-900 dark:text-white">Are these the same transfer?</p><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Confirming files both payments together. If they are separate, label the Barclays payment on its own.</p><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => onResolve(["pair"], "Both payments marked as one transfer.")} className={`${button} bg-indigo-600 text-white`}>Yes, same transfer</button><button type="button" onClick={() => { setShowPairCheck(false); setSeparate(true); }} className={`${button} border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200`}>Review separately</button></div></div> : choice ? <div className="mt-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><p className="text-sm font-semibold text-slate-900 dark:text-white">{choiceLabel}</p><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Only Barclays changes. The Starling entry stays for a separate review.</p><button type="button" onClick={() => onResolve(["pair"], `Barclays filed as ${choiceLabel}.`, true)} className={`${button} mt-3 bg-indigo-600 text-white`}>Save this payment</button></div> : <div className="mt-3"><p className="text-sm font-semibold text-slate-900 dark:text-white">What was the Barclays payment?</p><ChoiceButtons onChoose={(next) => next === "transfer" && !separate ? setShowPairCheck(true) : setChoice(next)} /></div>}
  </article>;
}

function SinglePayment({ hidden, onResolve, id = "monzo-single", account = "Everyday", detail = "Monzo · 2 Mar · FORIS MT LIMITED STO", amount = "−£25.00" }: { hidden: boolean; onResolve: (ids: ReviewId[], message: string, keepCredit?: boolean) => void; id?: ReviewId; account?: string; detail?: string; amount?: string }) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const choiceLabel = choices.find(item => item.key === choice)?.label;
  return <details className="rounded-2xl border border-slate-200 bg-white px-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
    <summary className="min-h-11 cursor-pointer list-none py-2 focus-visible:outline-2 focus-visible:outline-indigo-500">
      <Leg account={account} detail={detail} amount={amount} hidden={hidden} />
      <span className="flex items-center justify-between pb-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300">Review this payment<ChevronDown size={16} aria-hidden="true" /></span>
    </summary>
    <div className="border-t border-slate-200 pb-4 pt-3 dark:border-slate-700">
      <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">No matching payment was found in your connected accounts.</p>
      {choice ? <div className="mt-3"><p className="text-sm font-semibold text-slate-900 dark:text-white">{choiceLabel}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Only this payment changes.</p><button type="button" onClick={() => onResolve([id], `${account} filed as ${choiceLabel}.`)} className={`${button} mt-3 bg-indigo-600 text-white`}>Save this payment</button></div> : <div className="mt-3"><p className="text-sm font-semibold text-slate-900 dark:text-white">What was this payment?</p><ChoiceButtons onChoose={setChoice} /></div>}
    </div>
  </details>;

}


function CreditReview({ hidden, onResolve }: { hidden: boolean; onResolve: (ids: ReviewId[], message: string, keepCredit?: boolean) => void }) {
  return <section className="space-y-3" aria-label="Starling review">
    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Starling · 1 to review</h3>
    <article className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <Leg account="Personal" detail="Starling · 28 Feb · transfer received" amount="+£75.53" hidden={hidden} positive />
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">This entry is still marked as income. Where did it come from?</p>
      <div className="mt-3 grid gap-2">
        <button className={`${button} bg-indigo-600 text-white`} onClick={() => onResolve(["starling-single"], "Starling marked as a transfer from your own account.")}>Another of my accounts</button>
        <button className={`${button} border border-slate-200 dark:border-slate-600`} onClick={() => onResolve(["starling-single"], "Starling kept as income.")}>Keep as income</button>
      </div>
    </article>
  </section>;
}

function VariantA({ hidden, onResolve, resolved }: { hidden: boolean; onResolve: (ids: ReviewId[], message: string, keepCredit?: boolean) => void; resolved: Set<ReviewId> }) {
  const barclaysLeft = (resolved.has("pair") ? 0 : 1) + (resolved.has("barclays-single") ? 0 : 1);
  const monzoLeft = resolved.has("monzo-single") ? 0 : 1;
  return <div className="space-y-4"><div><h2 className="text-lg font-bold tracking-[-0.025em] text-slate-950 dark:text-white">Review a payment, then move on</h2><p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">Each choice starts with one payment. Confirm a pair only when you recognise both sides.</p></div>{barclaysLeft > 0 && <><div className="flex items-center justify-between border-b border-slate-200 pb-2 dark:border-slate-700"><p className="text-sm font-semibold text-slate-900 dark:text-white">From Barclays</p><p className="text-xs text-slate-500 dark:text-slate-400">{barclaysLeft} to review</p></div>{!resolved.has("pair") && <PairCandidate hidden={hidden} onResolve={onResolve} variant="a" />}{!resolved.has("barclays-single") && <><SinglePayment hidden={hidden} onResolve={onResolve} id="barclays-single" account="Premier Current Account" detail="Barclays · 12 Feb · KEVIN MAINGI STARLING STO" amount="−£75.53" /></>}</>}{monzoLeft > 0 && <><div className="flex items-center justify-between border-b border-slate-200 pb-2 dark:border-slate-700"><p className="text-sm font-semibold text-slate-900 dark:text-white">From Monzo</p><p className="text-xs text-slate-500 dark:text-slate-400">1 to review</p></div><SinglePayment hidden={hidden} onResolve={onResolve} /></>}</div>;
}

function VariantB({ hidden, onResolve, resolved }: { hidden: boolean; onResolve: (ids: ReviewId[], message: string, keepCredit?: boolean) => void; resolved: Set<ReviewId> }) {
  const barclaysLeft = (resolved.has("pair") ? 0 : 1) + (resolved.has("barclays-single") ? 0 : 1);
  return <div className="space-y-4"><div><h2 className="text-lg font-bold tracking-[-0.025em] text-slate-950 dark:text-white">Check the possible match first</h2><p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">Both account entries stay visible until you confirm they are one transfer.</p></div>{barclaysLeft > 0 && <section aria-labelledby="barclays-review" className="rounded-2xl border border-slate-200 p-3 dark:border-slate-700"><div className="flex items-center justify-between"><h3 id="barclays-review" className="text-sm font-bold text-slate-950 dark:text-white">Barclays</h3><span className="text-xs text-slate-500 dark:text-slate-400">{barclaysLeft} to review</span></div>{!resolved.has("pair") && <div className="mt-3"><PairCandidate hidden={hidden} onResolve={onResolve} variant="b" /></div>}{!resolved.has("barclays-single") && <div className="mt-3"><div className="mt-3"><SinglePayment hidden={hidden} onResolve={onResolve} id="barclays-single" account="Premier Current Account" detail="Barclays · 12 Feb · KEVIN MAINGI STARLING STO" amount="−£75.53" /></div></div>}</section>}{!resolved.has("monzo-single") && <section aria-labelledby="monzo-review" className="rounded-2xl border border-slate-200 p-3 dark:border-slate-700"><div className="flex items-center justify-between"><h3 id="monzo-review" className="text-sm font-bold text-slate-950 dark:text-white">Monzo</h3><span className="text-xs text-slate-500 dark:text-slate-400">1 to review</span></div><div className="mt-3"><SinglePayment hidden={hidden} onResolve={onResolve} /></div></section>}</div>;
}

export default function TransferReviewDecisionsClient() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "b" ? "b" : "a";
  const fixtureState: FixtureState = params.get("state") === "loading" ? "loading" : params.get("state") === "empty" ? "empty" : params.get("state") === "error" ? "error" : "ready";
  const dark = params.get("mode") === "dark";
  const hidden = params.get("hidden") === "1";
  const [state, setState] = useState<FixtureState>(fixtureState);
  const [resolved, setResolved] = useState<Set<ReviewId>>(new Set(["starling-single"]));
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); document.documentElement.style.colorScheme = dark ? "dark" : "light"; }, [dark]);
  useEffect(() => { setState(fixtureState); setResolved(new Set(["starling-single"])); setMessage(null); }, [fixtureState, variant]);
  const resolve = (ids: ReviewId[], next: string, keepCredit = false) => { setResolved(previous => { const updated = new Set(previous); ids.forEach(id => updated.add(id)); if (keepCredit) updated.delete("starling-single"); return updated; }); setMessage(next); };
  const left = 4 - resolved.size;
  const retry = () => { setState("ready"); setResolved(new Set(["starling-single"])); setMessage(null); };

  return <main className="min-h-dvh bg-slate-100 pb-14 text-slate-900 selection:bg-indigo-100 selection:text-slate-950 dark:bg-slate-950 dark:text-slate-100 dark:selection:bg-indigo-400/30 dark:selection:text-white"><div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10"><a href="/design" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400 dark:hover:text-white"><ArrowLeft size={16} aria-hidden="true" />Design rounds</a><header className="mt-4 max-w-xl"><h1 className="text-balance text-3xl font-bold tracking-[-0.04em] text-slate-950 dark:text-white">Review money moved between accounts</h1><p className="mt-2 text-pretty text-sm leading-6 text-slate-600 dark:text-slate-300">Check transfers that may change your spending picture. A possible pair is never filed until you confirm it.</p></header><PreviewControls variant={variant} state={fixtureState} dark={dark} hidden={hidden} />
    <section aria-label="Transfer review preview" className="mt-7 rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-sm sm:p-5 dark:border-slate-700 dark:bg-slate-900/50 dark:shadow-none"><div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-700"><div><p className="text-sm font-bold text-slate-950 dark:text-white">Transfers to review</p><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Fixture preview only. Nothing is saved.</p></div>{state === "ready" && <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300">{left} reviews left</span>}</div>
      {message && <div role="status" className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-400/10 dark:text-emerald-100"><Check size={17} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{message}</span><button type="button" onClick={() => setMessage(null)} aria-label="Dismiss saved message" className="ml-auto -m-1 grid size-11 place-items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><X size={15} aria-hidden="true" /></button></div>}
      {state === "loading" ? <div role="status" className="py-12 text-center"><RotateCw size={24} className="mx-auto animate-spin text-slate-500 dark:text-slate-400 motion-reduce:animate-none" aria-hidden="true" /><h2 className="mt-3 text-lg font-bold text-slate-950 dark:text-white">Checking your transfers</h2><p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-slate-600 dark:text-slate-300">Your earlier decisions stay unchanged while we look for possible matches.</p></div> : state === "error" ? <div role="alert" className="py-12 text-center"><AlertCircle size={24} className="mx-auto text-slate-500 dark:text-slate-400" aria-hidden="true" /><h2 className="mt-3 text-lg font-bold text-slate-950 dark:text-white">We could not load these transfers</h2><p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-slate-600 dark:text-slate-300">Your earlier decisions have not changed. Try again to see any payments still waiting for review.</p><button type="button" onClick={retry} className={`${button} mt-4 bg-indigo-600 text-white`}><RotateCw size={15} className="mr-2" aria-hidden="true" />Try again</button></div> : state === "empty" || left === 0 ? <div className="py-12 text-center"><span className="mx-auto grid size-11 place-items-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300"><ShieldCheck size={21} aria-hidden="true" /></span><h2 className="mt-3 text-lg font-bold text-slate-950 dark:text-white">Nothing needs review</h2><p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-slate-600 dark:text-slate-300">Payments you have already confirmed or dismissed will not come back unless the transaction changes.</p></div> : <div className="mt-5">{variant === "a" ? <VariantA hidden={hidden} onResolve={resolve} resolved={resolved} /> : <VariantB hidden={hidden} onResolve={resolve} resolved={resolved} />}{!resolved.has("starling-single") && <div className="mt-4"><CreditReview hidden={hidden} onResolve={resolve} /></div>}</div>}
      <p className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">Synthetic examples. Card repayment handling is being developed in G381.</p>
    </section></div></main>;
}
