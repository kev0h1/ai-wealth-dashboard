"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { Bank } from "@/components/BankPickerSheet";
import BankConnectionFlow from "@/components/bank-connect/BankConnectionFlow";
import { primary, quiet, type MergedStep } from "@/components/bank-connect/BankConnectionParts";
import { useBankReturnReset } from "@/lib/useBankReturnReset";
import { fixtureBanks } from "../bank-picker/fixtures";
import MockFinexer, { type FinexerStage } from "./MockFinexer";

type VariantId = "today" | "a" | "b" | "c";
const VARIANTS: { id: VariantId; label: string; merged?: MergedStep; taps: number; blurb: string; note: string }[] = [
  { id: "today", label: "Today (G)", taps: 4, blurb: "Choose a bank, then Sorted's Review your connection step, then Finexer.", note: "Shipped in A155. Four taps before the bank." },
  { id: "a", label: "A · Notice under the list", merged: "footer", taps: 3, blurb: "A short summary and the full sentence stay pinned under the list. One tap on a bank opens Finexer.", note: "Sentence visible by default. Smallest interpretive risk, less room for the list." },
  { id: "b", label: "B · One pinned line", merged: "pinned-line", taps: 3, blurb: "One pinned line opens in place to the full sentence. One tap on a bank opens Finexer.", note: "Sentence is behind a tap the user is not made to take. Needs Finexer to confirm it meets A4.2." },
  { id: "c", label: "C · Notice above the search", merged: "header", taps: 3, blurb: "The summary and the full sentence sit above the search field. One tap on a bank opens Finexer.", note: "Sentence visible by default. Tallest fixed header, least room for the list." },
];

const subscribeToOrigin = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => null;

type Stage = "sorted" | FinexerStage | "bank" | "returned";

function Run({ variant, banks, state, dark, onStart }: { variant: (typeof VARIANTS)[number]; banks: Bank[]; state: string; dark: boolean; onStart(): void }) {
  const [stage, setStage] = useState<Stage>("sorted");
  const [bank, setBank] = useState<Bank | null>(null);
  const [connecting, setConnecting] = useState<string | null>(state === "pending" ? "pending" : null);
  const [error, setError] = useState<string | null>(null);
  const [taps, setTaps] = useState(0);
  const [run, setRun] = useState(0);
  const handoff = useRef(false);
  const failedOnce = useRef(false);
  const timers = useRef<number[]>([]);
  // A149: the production reset hook, so closing Finexer's page behaves like Cancel.
  const bankReturn = useBankReturnReset(() => setConnecting(null));

  useEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), []);
  // Count only the taps a user must make: a bank row and Sorted's Continue button.
  useEffect(() => {
    if (stage !== "sorted") return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button");
      if (!button || button.disabled) return;
      if (button.matches('[data-flow-focus^="bank-"]') || button.textContent?.startsWith("Continue to Finexer")) setTaps(t => t + 1);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [stage]);

  const restart = () => { handoff.current = false; failedOnce.current = false; setConnecting(null); setError(null); setTaps(0); setBank(null); setRun(r => r + 1); setStage("sorted"); onStart(); };
  const counter = <p data-tap-counter role="status" className="pointer-events-none fixed inset-x-0 top-2 z-[80] mx-auto w-fit rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">Taps before the bank: {taps}</p>;

  if (stage === "wait" || stage === "next" || stage === "connect") return <>
    {counter}
    <div className="pt-12"><MockFinexer stage={stage} dark={dark} bankName={bank?.name ?? "your bank"}
      onClose={restart} onNext={() => { setTaps(t => t + 1); setStage("connect"); }} onConnect={() => { setTaps(t => t + 1); setStage("bank"); }} /></div>
  </>;
  if (stage === "bank" || stage === "returned") return <main className="min-h-dvh bg-[#f0f2f7] px-5 py-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">{counter}
    <div className="mx-auto max-w-lg pt-12">
      <h1 className="text-xl font-bold">{stage === "bank" ? `Next, ${bank?.name ?? "your bank"}` : "Back in Sorted"}</h1>
      <p className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-200">{stage === "bank" ? "Your bank would ask you to approve access here. This is the end of the mocked hand-off. No bank has been connected." : "Mocked return. No bank was connected and no permission was given."}</p>
      <button type="button" className={`${primary} mt-6`} onClick={stage === "bank" ? () => setStage("returned") : restart}>{stage === "bank" ? "Approve (mocked)" : "Start again"}</button>
    </div></main>;

  return <main className="min-h-dvh bg-[#f0f2f7] px-5 py-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    {counter}
    <div className="mx-auto max-w-lg pt-12">
      <h1 className="text-xl font-bold">{variant.label}</h1>
      <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">{variant.blurb}</p>
      <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{variant.note}</p>
      <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">Required taps: {variant.taps} before the bank&apos;s own page{variant.id === "b" ? ". Opening the details is optional and not counted." : "."} Banks are fixtures, nothing connects.</p>
    </div>
    <BankConnectionFlow key={`${variant.id}-${state}-${run}`} banks={banks} loading={false} loadError={null}
      connectionError={error} connecting={connecting} mergedStep={variant.merged} mergedNoticeOpen={state === "expanded"}
      initialQuery={state === "noresults" ? "zzq" : ""} onRetry={() => {}}
      onConnect={(chosen, close) => {
        if (state === "error" && !failedOnce.current) { failedOnce.current = true; setError("Finexer did not open. Please try again. Preview only: no request was sent."); return; }
        setError(null); setBank(chosen); setConnecting(chosen.id); bankReturn.begin();
        timers.current.push(window.setTimeout(() => { handoff.current = true; close(); }, 900));
      }}
      onClose={() => {
        if (handoff.current) { setStage("wait"); window.scrollTo(0, 0); timers.current.push(window.setTimeout(() => setStage("next"), 900)); }
        else restart();
      }} />
  </main>;
}

export default function MergeReviewClient() {
  const search = useSearchParams();
  const requested = VARIANTS.find(v => v.id === search.get("variant"));
  const [variantId, setVariantId] = useState<VariantId | null>(requested?.id ?? null);
  const [mode, setMode] = useState<"light" | "dark">(search.get("mode") === "dark" ? "dark" : "light");
  const state = search.get("state") ?? "start";
  const origin = useSyncExternalStore(subscribeToOrigin, getOrigin, getServerOrigin);
  useEffect(() => {
    const wasDark = document.documentElement.classList.contains("dark");
    const previousScheme = document.documentElement.style.colorScheme;
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    return () => { document.documentElement.classList.toggle("dark", wasDark); document.documentElement.style.colorScheme = previousScheme; };
  }, [mode]);
  const variant = VARIANTS.find(v => v.id === variantId);
  if (variant && origin) return <Run key={`${variant.id}-${state}`} variant={variant} banks={fixtureBanks(origin)} state={state} dark={mode === "dark"} onStart={() => {}} />;
  return <main className="min-h-dvh bg-[#f0f2f7] px-5 pb-20 pt-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <div className="mx-auto max-w-2xl">
      <div className="flex flex-wrap items-center justify-between gap-2"><a href="/design" className={`${quiet} -ml-3`}><ArrowLeft size={16} aria-hidden="true" />Design previews</a><button type="button" className={quiet} onClick={() => setMode(mode === "light" ? "dark" : "light")}>{mode === "light" ? "Dark theme" : "Light theme"}</button></div>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Fewer taps before the bank</h1>
      <p className="mt-3 max-w-lg text-sm leading-6 text-slate-700 dark:text-slate-200">Finexer&apos;s Next and Connect stay. These variants merge Sorted&apos;s own review step into the bank list, so one tap on a bank opens Finexer. Each is a full tap-through ending in a mocked Finexer page.</p>
      <div className="mt-8 divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-700 dark:border-slate-700">{VARIANTS.map(v => <section key={v.id} className="py-6">
        <h2 className="text-lg font-bold">{v.label}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">{v.blurb}</p>
        <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{v.note} Taps before the bank: {v.taps}.</p>
        <button type="button" onClick={() => setVariantId(v.id)} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950">Try {v.id === "today" ? "today's flow" : v.id.toUpperCase()}</button>
      </section>)}</div>
    </div>
  </main>;
}
