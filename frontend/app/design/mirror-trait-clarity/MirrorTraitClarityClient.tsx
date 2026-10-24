"use client";

import Link from "next/link";
import { Check, ChevronDown, HeartPulse, LoaderCircle, PencilLine, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import MoneyText from "@/components/MoneyText";

type Choice = "keep" | "change" | null;
type State = "all" | "kept" | "change" | "pending" | "save-error" | "hidden" | "long";

type Trait = { id: string; title: string; narrative: string; evidence: string[]; mark?: "health"; choice: Choice };

const states: State[] = ["all", "kept", "change", "pending", "save-error", "hidden", "long"];
const controls = "inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-3 py-2 text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-100 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800";
const quietFocus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800";

function displayText(text: string, hidden: boolean) {
  return hidden ? text.replace(/£[\d,]+(?:\.\d+)?/g, "£••••") : text;
}

function initialTraits(state: State): Trait[] {
  const traits: Trait[] = [
    { id: "signature", title: "Your Signature: Health", narrative: "Health is your most frequent category for optional spending.", evidence: ["25 Health payments in this window", "£1,268 total · about 5 times a month"], mark: "health", choice: null },
    { id: "clean", title: "Clean record", narrative: "No matching returned-payment or late-fee descriptions were found in this window.", evidence: ["179 days of recorded transactions checked"], choice: null },
  ];
  if (state === "kept") traits[0].choice = "keep";
  if (state === "change") traits[0].choice = "change";
  if (state === "long") {
    traits[1].title = "Moving money between several everyday and household accounts";
    traits[1].narrative = "You make regular transfers between your everyday, household and savings accounts, including £15,790 in this window. Transfers move money between accounts and do not show how much you have spent.";
    traits[1].evidence = ["15 accounts actively used for transfers", "About £15,790 moved between accounts each month"];
  }
  return traits;
}

export default function MirrorTraitClarityClient() {
  const params = useSearchParams();
  const variant = params.get("variant") === "b" ? "b" : "a";
  const rawState = params.get("state");
  const state: State = states.includes(rawState as State) ? rawState as State : "all";
  const dark = params.get("mode") === "dark";
  return <Preview key={`${variant}-${state}-${dark}`} variant={variant} state={state} dark={dark} />;
}

function Preview({ variant, state, dark }: { variant: "a" | "b"; state: State; dark: boolean }) {
  const [traits, setTraits] = useState(() => initialTraits(state));
  const [open, setOpen] = useState<string | null>(state === "pending" ? "signature" : null);
  const [pendingId, setPendingId] = useState<string | null>(state === "pending" ? "signature" : null);
  const [saveErrorId, setSaveErrorId] = useState<string | null>(state === "save-error" ? "signature" : null);
  const hidden = state === "hidden";
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); document.documentElement.style.colorScheme = dark ? "dark" : "light"; }, [dark]);
  const href = (patch: Record<string, string>) => `/design/mirror-trait-clarity?${new URLSearchParams({ variant, state, mode: dark ? "dark" : "light", ...patch })}`;
  const select = (id: string, choice: Exclude<Choice, null>) => {
    if (pendingId) return;
    setSaveErrorId(null);
    setPendingId(id);
    window.setTimeout(() => { setTraits(previous => previous.map(trait => trait.id === id ? { ...trait, choice } : trait)); setPendingId(null); setOpen(null); }, 450);
  };
  return <main data-g332-preview className="min-h-dvh bg-[#f0f2f7] pb-12 text-slate-900 dark:bg-[#0f172a] dark:text-slate-100">
    <div className="mx-auto max-w-[980px] px-4 pt-5">
      <section aria-label="Design round controls" className="mb-7 border-b border-slate-300 pb-5 dark:border-slate-600">
        <p className="text-xl font-bold">Mirror trait clarity</p>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">G332 preview. Synthetic observations and local choices only. No accounts, traits or coaching preferences change.</p>
        <nav className="mt-3 flex flex-wrap gap-2" aria-label="Design variants">
          <Link href={href({ variant: "a" })} className={`${controls} ${variant === "a" ? "border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 dark:border-indigo-500 dark:bg-indigo-500" : ""}`}>A · Two clear answers</Link>
          <Link href={href({ variant: "b" })} className={`${controls} ${variant === "b" ? "border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 dark:border-indigo-500 dark:bg-indigo-500" : ""}`}>B · One decision row</Link>
        </nav>
        <p className="mt-2 max-w-2xl text-[13px] leading-5 text-slate-600 dark:text-slate-300">{variant === "a" ? "A makes each choice visible without repeating the rule." : "B gives an untouched observation a quieter ending, then opens the same explicit choice when asked."}</p>
        <details className="mt-3"><summary className={`flex min-h-11 cursor-pointer items-center rounded text-[13px] font-semibold ${quietFocus}`}>Examples and display</summary><nav className="mt-2 flex flex-wrap gap-2" aria-label="Synthetic states">{states.map(value => <Link key={value} href={href({ state: value })} className={controls} aria-current={value === state ? "page" : undefined}>{value}</Link>)}<Link href={href({ mode: dark ? "light" : "dark" })} className={controls}>{dark ? "Light theme" : "Dark theme"}</Link></nav></details>
      </section>
      <header className="max-w-2xl"><h1 className="text-[28px] font-bold leading-tight tracking-tight">How your money behaves</h1><p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Computed from recent transactions. These are observations, not a verdict on you.</p></header>
      <p className="mt-5 max-w-2xl rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-[13px] leading-5 text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300"><ShieldCheck className="mr-2 inline-block text-indigo-600 dark:text-indigo-300" size={16} aria-hidden="true" />Choose separately for each trait. Coaching stays off until you choose change. If you keep one, Sorted will not coach you on it.</p>
      <section className="mt-5 grid items-start gap-4 min-[820px]:grid-cols-2" aria-label="Money traits">{traits.map(trait => <TraitCard key={trait.id} trait={trait} variant={variant} expanded={open === trait.id} setExpanded={() => setOpen(open === trait.id ? null : trait.id)} pending={pendingId === trait.id} saveError={saveErrorId === trait.id} hidden={hidden} onSelect={choice => select(trait.id, choice)} />)}</section>
    </div>
  </main>;
}

function TraitCard({ trait, variant, expanded, setExpanded, pending, saveError, hidden, onSelect }: { trait: Trait; variant: "a" | "b"; expanded: boolean; setExpanded(): void; pending: boolean; saveError: boolean; hidden: boolean; onSelect(choice: Exclude<Choice, null>): void }) {
  const selected = trait.choice;
  return <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
    <div className="p-4">
      <div className="flex items-start gap-3">{trait.mark && <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300"><HeartPulse size={18} aria-hidden="true" /></span>}<div className="min-w-0"><h2 className="text-base font-bold leading-snug"><MoneyText text={displayText(trait.title, hidden)} /></h2><p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300"><MoneyText text={displayText(trait.narrative, hidden)} /></p></div></div>
      <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-700"><p className="text-[11px] font-semibold uppercase tracking-[.05em] text-slate-500 dark:text-slate-400">What we saw</p><ul className="mt-2 space-y-1 text-[13px] leading-5 text-slate-600 dark:text-slate-300">{trait.evidence.map(item => <li key={item}><MoneyText text={displayText(item, hidden)} /></li>)}</ul></div>
    </div>
    {variant === "a" ? <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-700"><p className="mb-2 text-[13px] font-medium text-slate-700 dark:text-slate-200">How should Sorted use this?</p><div className="grid grid-cols-2 gap-2"><ChoiceButton active={selected === "keep"} disabled={pending} onClick={() => onSelect("keep")}>Keep it</ChoiceButton><ChoiceButton active={selected === "change"} disabled={pending} onClick={() => onSelect("change")}>Help me change</ChoiceButton></div></div> : <div className="border-t border-slate-100 dark:border-slate-700">{selected ? <div className="px-4 py-3"><button type="button" aria-expanded={expanded} onClick={setExpanded} className={`min-h-11 text-[13px] font-semibold text-indigo-700 hover:underline dark:text-indigo-300 ${quietFocus}`}>Change this choice</button></div> : <button type="button" aria-expanded={expanded} onClick={setExpanded} className={`flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left text-[13px] font-semibold text-indigo-700 hover:bg-slate-50 dark:text-indigo-300 dark:hover:bg-slate-700/50 ${quietFocus}`}>Choose how to use this <ChevronDown className={expanded ? "rotate-180" : ""} size={17} aria-hidden="true" /></button>}{expanded && <div className="grid grid-cols-2 gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-700"><ChoiceButton active={selected === "keep"} disabled={pending} onClick={() => onSelect("keep")}>Keep it</ChoiceButton><ChoiceButton active={selected === "change"} disabled={pending} onClick={() => onSelect("change")}>Help me change</ChoiceButton></div>}</div>}
    {(pending || saveError || selected) && <div className="border-t border-slate-100 px-4 py-3 text-[13px] leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300" role="status">{pending ? <><LoaderCircle className="mr-1 inline animate-spin motion-reduce:animate-none" size={15} aria-hidden="true" />Saving your choice…</> : saveError ? "That did not save. Choose an option again to retry." : selected === "keep" ? <><Check className="mr-1 inline text-emerald-600 dark:text-emerald-400" size={15} aria-hidden="true" />Kept. No coaching will start for this trait.</> : <><PencilLine className="mr-1 inline text-indigo-600 dark:text-indigo-300" size={15} aria-hidden="true" />Changed. The next step is to set a pace, if you want one.</>}</div>}
  </article>;
}

function ChoiceButton({ active, disabled, onClick, children }: { active: boolean; disabled: boolean; onClick(): void; children: ReactNode }) {
  return <button type="button" aria-pressed={active} disabled={disabled} onClick={onClick} className={`min-h-11 rounded-xl border px-2 text-[13px] font-semibold transition-colors active:opacity-70 ${quietFocus} disabled:opacity-60 ${active ? "border-indigo-600 bg-indigo-50 text-indigo-800 dark:border-indigo-400 dark:bg-indigo-950/40 dark:text-indigo-200" : "border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"}`}>{children}</button>;
}
