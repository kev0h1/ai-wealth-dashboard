"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import UpcomingFlowSheet from "@/components/UpcomingFlowSheet";
import type { Bank } from "@/components/BankPickerSheet";
import { fixtureBanks } from "../bank-picker/fixtures";
import HostedConsentPreview from "./HostedConsentPreview";
import { BankChooser, ChosenBank, ConnectionNotice, ContinueAction, DIRECTIONS, primary, quiet, type Journey } from "./journeyParts";

type View = "choose" | "review" | "continuous" | "provider" | "end" | "error";
const subscribeToOrigin = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => null;

function JourneyFlow({ variant, banks, mode, initialState, onClose }: {
  variant: Journey; banks: Bank[]; mode: "light" | "dark"; initialState: string; onClose(): void;
}) {
  const [query, setQuery] = useState(initialState === "noresults" ? "zzq" : "");
  const [selected, setSelected] = useState<Bank | null>(initialState === "error" ? banks.find(bank => bank.name === "Monzo") ?? banks[0] : null);
  const [choosing, setChoosing] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const initialView: View = initialState === "error" ? "error" : variant === "h" ? "continuous" : "choose";
  const changeInline = () => {
    setChoosing(true);
    requestAnimationFrame(() => { searchRef.current?.focus(); searchRef.current?.scrollIntoView({ block: "nearest" }); });
  };
  return <UpcomingFlowSheet<View> initialView={initialView} onClose={onClose} renderView={(view, navigation) => {
    const chooseBank = (bank: Bank) => {
      setSelected(bank);
      if (variant === "h") {
        setChoosing(false);
        requestAnimationFrame(() => { summaryRef.current?.focus({ preventScroll: true }); summaryRef.current?.scrollIntoView({ block: "start" }); });
      } else navigation.goTo(variant === "i" ? "provider" : "review");
    };
    const chooser = <BankChooser banks={banks} query={query} setQuery={setQuery} searchRef={searchRef} onChoose={chooseBank} selected={selected} />;
    if (view === "choose") return {
      title: "Choose your bank", subtitle: variant === "i" ? "Continue through Finexer to connect to Sorted." : "Start with the bank you want to add to Sorted.",
      body: chooser,
      footer: <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">{variant === "i" ? "Next: review the connection and permissions with Finexer." : "Next: review how this connection works."}</p>,
    };
    if (view === "continuous") return {
      title: "Connect your bank", subtitle: "Choose a bank, then review the connection below.",
      body: <>
        {choosing ? <><h2 className="mb-2 text-sm font-semibold">Choose your bank</h2>{chooser}</> : selected && <>
          <h2 ref={summaryRef} tabIndex={-1} className="sr-only outline-none">Review your connection</h2>
          <ChosenBank bank={selected} onChange={changeInline} />
        </>}
        <ConnectionNotice />
      </>,
      footer: selected && !choosing ? <ContinueAction onContinue={() => navigation.goTo("provider")} /> : <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">Choose a bank to continue. No connection starts yet.</p>,
    };
    if (view === "review") return {
      title: "Review your connection", subtitle: "Understand what you are connecting before you continue.",
      body: <>{selected && <ChosenBank bank={selected} onChange={navigation.back} />}<ConnectionNotice /></>,
      footer: <ContinueAction onContinue={() => navigation.goTo("provider")} />,
    };
    if (view === "provider") return {
      title: "Finexer consent", subtitle: "Preview only. This step normally opens outside Sorted.",
      body: <HostedConsentPreview mode={mode} disclosureAtProvider={variant === "i"} bankName={selected?.name ?? "your bank"} onBack={navigation.back} onContinue={() => navigation.goTo("end")} />,
    };
    if (view === "error") return {
      title: "Finexer did not open", subtitle: "Simulated handoff problem. No request was sent.",
      body: <div className="py-2"><h2 className="text-base font-semibold">Your bank choice is still here</h2><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Try again to continue with {selected?.name ?? "your bank"}, or return to the bank list.</p><button type="button" className={`${quiet} mt-4 -ml-3`} onClick={() => { if (variant === "h") setChoosing(true); navigation.goTo(variant === "h" ? "continuous" : "choose"); }}>Change bank</button></div>,
      footer: <button type="button" className={primary} onClick={() => { setChoosing(false); navigation.goTo(variant === "g" ? "review" : variant === "h" ? "continuous" : "provider"); }}>Try again in preview</button>,
    };
    return {
      title: "Next, your bank", subtitle: "End of this design preview.",
      body: <div className="py-2"><h2 className="text-base font-semibold">Approval happens with {selected?.name ?? "your bank"}</h2><p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">After Finexer, your bank would ask you to approve access. You would then return to Sorted.</p><p className="mt-5 border-t border-slate-200 pt-5 text-sm leading-6 text-slate-600 dark:border-slate-700 dark:text-slate-300">No bank has been connected. No permission has been given.</p></div>,
      footer: <button type="button" className={primary} onClick={navigation.close}>Compare journeys</button>,
    };
  }} />;
}

export default function ConsentJourneysClient() {
  const search = useSearchParams();
  const initialVariant = DIRECTIONS.find(direction => direction.id === search.get("variant"))?.id ?? null;
  const [variant, setVariant] = useState<Journey | null>(initialVariant);
  const [mode, setMode] = useState<"light" | "dark">(search.get("mode") === "dark" ? "dark" : "light");
  const origin = useSyncExternalStore(subscribeToOrigin, getOrigin, getServerOrigin);
  const [initialState, setInitialState] = useState(search.get("state") ?? "start");
  useEffect(() => {
    const wasDark = document.documentElement.classList.contains("dark");
    const previousScheme = document.documentElement.style.colorScheme;
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    return () => { document.documentElement.classList.toggle("dark", wasDark); document.documentElement.style.colorScheme = previousScheme; };
  }, [mode]);
  const open = (next: Journey, state = "start") => { setInitialState(state); setVariant(next); };
  return <main className="min-h-dvh bg-[#f0f2f7] px-5 pb-20 pt-6 text-slate-900 selection:bg-indigo-100 selection:text-indigo-950 dark:bg-slate-950 dark:text-slate-100 dark:selection:bg-indigo-900 dark:selection:text-indigo-100 sm:px-8">
    <div className="mx-auto max-w-2xl">
      <div className="flex flex-wrap items-center justify-between gap-2"><a href="/design" className={`${quiet} -ml-3`}><ArrowLeft size={16} aria-hidden="true" />Design previews</a><button type="button" className={quiet} onClick={() => setMode(mode === "light" ? "dark" : "light")}>{mode === "light" ? "Dark theme" : "Light theme"}</button></div>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Bank connection journeys</h1>
      <p className="mt-3 max-w-lg text-sm leading-6 text-slate-600 dark:text-slate-300">Three new ways to make the required wording part of the journey. Try choosing a bank, reading the notice and moving to the next step.</p>
      <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-300">A155 · Round 3 · Design only. All banks are fixtures. No connection starts.</p>
      <div className="mt-8 divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-700 dark:border-slate-700">{DIRECTIONS.map(direction => <section key={direction.id} className="py-6">
        <h2 className="text-lg font-bold">{direction.id.toUpperCase()} · {direction.title}</h2>
        <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">{direction.route}</p>
        <p className="mt-3 max-w-lg text-sm leading-6 text-slate-600 dark:text-slate-300">{direction.description}</p>
        <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{direction.tradeoff}</p>
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => open(direction.id)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950">Try {direction.id.toUpperCase()} <ArrowRight size={16} aria-hidden="true" /></button><button type="button" onClick={() => open(direction.id, "error")} className={quiet}>Handoff problem</button></div>
      </section>)}</div>
      <p className="mt-6 text-xs leading-5 text-slate-600 dark:text-slate-300">Finexer screens are illustrations of the provider step, not live connections. Option I proposes changing the Sorted intro there and needs Finexer approval.</p>
      <a href="/design/bank-picker" className={`${quiet} mt-3 -ml-3`}>Earlier A to F previews</a>
    </div>
    {variant && origin && <JourneyFlow key={`${variant}-${initialState}`} variant={variant} mode={mode} initialState={initialState} banks={fixtureBanks(origin)} onClose={() => setVariant(null)} />}
  </main>;
}
