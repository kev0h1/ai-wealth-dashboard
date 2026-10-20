"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { DisclosureChevron } from "@/components/Disclosure";
import AimSheet from "@/components/AimSheet";
import MirrorEvidence from "@/components/MirrorEvidence";
import MirrorFeedbackCard from "@/components/MirrorFeedbackCard";
import MirrorNextStep from "@/components/MirrorNextStep";
import { completedFor, leadingTrait, mirrorCategory } from "@/lib/mirrorFeedback";
import type { ActiveAim, MirrorTrait } from "@/lib/api";
import PreviewTraitCard from "./PreviewTraitCard";
import { ACTIVE, COMPLETED, COMPUTED_AT, EXPLANATION, SCENARIOS, fixtureAim, fixtureTraits, type Scenario } from "./fixtures";
import styles from "./preview.module.css";

const control = "inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-3 py-2 text-[13px] font-semibold transition-colors hover:bg-slate-100 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:hover:bg-slate-800";
const action = "inline-flex min-h-11 items-center gap-2 rounded-lg text-[13px] font-semibold text-indigo-700 hover:text-indigo-800 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:text-indigo-200";

export default function MirrorReadingEdgeClient() {
  const params = useSearchParams();
  const variant = params.get("variant") === "b" ? "b" : "a";
  const scenario: Scenario = SCENARIOS.find(value => value === params.get("state")) ?? "all";
  const dark = params.get("mode") === "dark";
  const clean = params.get("clean") === "1";
  return <Preview key={`${variant}-${scenario}-${dark}`} variant={variant} scenario={scenario} dark={dark} clean={clean} />;
}

function Preview({ variant, scenario, dark, clean }: { variant: "a" | "b"; scenario: Scenario; dark: boolean; clean: boolean }) {
  const [traits, setTraits] = useState(() => fixtureTraits(scenario));
  const [aims, setAims] = useState<ActiveAim[]>(scenario === "active" ? [{ ...ACTIVE }] : []);
  const history = scenario === "completed" ? [COMPLETED] : [];
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [othersOpen, setOthersOpen] = useState(true);
  const [feedbackError, setFeedbackError] = useState(scenario === "error");
  const [failChoice, setFailChoice] = useState(scenario === "save-error");
  const [editor, setEditor] = useState<{ trait: MirrorTrait; seed?: number } | null>(null);
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const primaryRef = useRef<HTMLDivElement>(null);
  const othersId = useId();
  const masked = scenario === "hidden";
  const primary = traits.find(trait => trait.id === focusedId) ?? leadingTrait(traits, aims, history);
  const others = traits.filter(trait => trait.id !== primary?.id);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [dark]);

  const href = (patch: { variant?: string; state?: string; mode?: string }) => `/design/mirror-reading-edge?${new URLSearchParams({ variant, state: scenario, mode: dark ? "dark" : "light", ...patch })}`;
  const choose = async (trait: MirrorTrait, choice: "keep" | "change") => {
    if (failChoice) { setFailChoice(false); throw Error("Synthetic failure"); }
    setFocusedId(id => id ?? primary?.id ?? trait.id);
    setTraits(previous => previous.map(item => item.id === trait.id ? { ...item, choice } : item));
  };
  const viewEvidence = (id: string) => {
    setFocusedId(id); setOthersOpen(false);
    requestAnimationFrame(() => { primaryRef.current?.focus(); primaryRef.current?.scrollIntoView({ block: "start" }); });
  };
  const card = (trait: MirrorTrait) => {
    const category = mirrorCategory(trait), active = aims.find(aim => aim.ref === category) ?? null;
    const kind = category ? "aim" : trait.id === "front_loader" ? "checkpoint" : trait.id === "saving_habit" ? "plan" : null;
    return <PreviewTraitCard key={trait.id} variant={variant} selected={trait.id === primary?.id} onEvidence={() => viewEvidence(trait.id)} trait={trait} category={category} activeAim={active} completed={completedFor(category, history)} loading={scenario === "loading"} error={feedbackError ? "synthetic offline" : null} masked={masked}
      onChoice={choice => choose(trait, choice)} onEdit={seed => { if (masked) setNotice("Show figures to set or adjust an aim."); else setEditor({ trait, seed }); }}
      onKeep={async amount => { if (masked) throw Error("Figures are hidden"); setAims([{ ...fixtureAim(amount), ref: category! }]); }}
      onStop={async () => setAims(previous => previous.filter(aim => aim.ref !== category))} onRetry={() => setFeedbackError(false)}
      nextStep={kind ? <MirrorNextStep kind={kind} category={category ?? undefined} amount={masked ? null : 100.25} onAct={() => kind === "plan" ? setNotice("Preview only. This opens Planning in the app.") : masked ? setNotice("Show figures to set or adjust an aim.") : setEditor({ trait })} onSeeNext={() => setNotice("Preview only. This returns to Spend in the app.")} /> : undefined} />;
  };

  return <div data-g302-preview data-ready={ready} className="min-h-dvh bg-[#f0f2f7] pb-10 text-slate-900 dark:bg-[#0f172a] dark:text-slate-100">
    <div className="mx-auto max-w-[1080px] px-4 pt-5">
      {!clean && <section aria-label="Design round controls" className="mb-6 border-b border-slate-300 pb-5 dark:border-slate-600">
        <p className="text-xl font-bold">Mirror card reading edge</p>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">G302 design preview. Real G286 cards, local examples and proposed layout/copy. No account changes.</p>
        <nav aria-label="Design variants" className="mt-3 flex flex-wrap gap-2">{([['a','A · Quiet link'],['b','B · Evidence row']] as const).map(([value,label]) => <Link key={value} href={href({ variant: value })} aria-current={variant === value ? "page" : undefined} className={`${control} ${variant === value ? "bg-indigo-600 text-white hover:bg-indigo-700 dark:hover:bg-indigo-700" : ""}`}>{label}</Link>)}</nav>
        <p className="mt-2 text-[13px] leading-5 text-slate-600 dark:text-slate-300">{variant === "a" ? "A keeps the evidence action quiet, on the same reading edge as the facts." : "B makes the entire evidence row tappable, with a hairline separating it from the choices."}</p>
        <details className="mt-3"><summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-semibold">Examples and display</summary><nav aria-label="Synthetic examples" className="mt-2 flex flex-wrap gap-2">{SCENARIOS.map(value => <Link key={value} href={href({ state: value })} className={control} aria-current={scenario === value ? "page" : undefined}>{value}</Link>)}<Link className={control} href={href({ mode: dark ? "light" : "dark" })}>{dark ? "Light theme" : "Dark theme"}</Link></nav><p className="mt-3 max-w-2xl text-xs leading-5 text-slate-600 dark:text-slate-400">Aim and permission controls use fixture callbacks. The evidence column shows portrait observations, not live transactions or a completed-aim ledger. Payment-record loading is guarded. Production components, APIs and stored choices are unchanged.</p></details>
      </section>}
      <header className="max-w-2xl"><h1 className="text-[28px] font-bold leading-tight tracking-tight">How your money behaves</h1><p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">Computed from your last 6 months of transactions. No judgement, just what the data says.</p></header>
      {notice && <p role="status" className="mt-3 text-[13px] text-slate-600 dark:text-slate-300">{notice}</p>}
      {scenario === "empty" || scenario === "insufficient" ? <section className="mt-5 max-w-2xl"><h2 className="text-base font-bold">{scenario === "empty" ? "No distinct patterns yet" : "Not enough history yet"}</h2><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{scenario === "empty" ? "Check again after more transactions have synced." : "The Mirror needs at least 60 days of transactions. A result waits until there is enough recorded history."}</p></section> : primary && <>
        {!others.length && <p data-coaching-explanation className="mt-4 max-w-2xl text-[13px] leading-6 text-slate-600 dark:text-slate-300">{EXPLANATION}</p>}
        <div className="mt-5 grid items-start gap-4 min-[900px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] min-[900px]:gap-6">
          <div className="min-w-0"><div ref={primaryRef} tabIndex={-1} data-primary-pattern className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">{card(primary)}</div>
            {others.length > 0 && <section className="mt-5 border-t border-slate-300 dark:border-slate-600"><button type="button" aria-expanded={othersOpen} aria-controls={othersId} onClick={() => setOthersOpen(open => !open)} className={`${action} w-full justify-between text-left text-slate-900 dark:text-slate-100`}>Other patterns<DisclosureChevron open={othersOpen} /></button>
              <p data-coaching-explanation className="mb-3 text-[13px] leading-6 text-slate-600 dark:text-slate-300">{EXPLANATION}</p>
              <div id={othersId} hidden={!othersOpen} className="space-y-3">{others.map(card)}</div>
            </section>}
          </div>
          <div id="g302-evidence" aria-label={`Evidence for ${primary.title}`} className="min-w-0 scroll-mt-5 rounded-2xl" onClickCapture={event => { if ((event.target as HTMLElement).closest("button,a")) { event.preventDefault(); event.stopPropagation(); setNotice("Preview only. No connected-bank records are loaded."); } }}>
            <MirrorEvidence key={primary.id} trait={primary} checkpointId={null} masked={masked} computedAt={COMPUTED_AT} />
          </div>
        </div>
      </>}
      {!clean && <details className="mt-8 max-w-xl border-t border-slate-300 pt-3 dark:border-slate-600"><summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-semibold">Current card for comparison</summary><div inert className={`${styles.reference} mt-3`}><MirrorFeedbackCard trait={{ ...fixtureTraits("single")[0], title: "Your Signature: Eating Out", narrative: "Eating Out shows up frequently.", evidence: ["£2731 total · ~25.8× per month"] }} category="Eating Out" activeAim={null} completed={null} loading={false} error={null} masked={masked} onChoice={async () => {}} onEdit={() => {}} onKeep={async () => {}} onStop={async () => {}} onRetry={() => {}} /></div></details>}
    </div>
    {editor && <AimSheet category={mirrorCategory(editor.trait)!} existingAmount={aims.find(aim => aim.ref === mirrorCategory(editor.trait)) ? editor.seed : undefined} baseline={{ usual: 108, suggestedAim: 100.25 }} onClose={() => setEditor(null)} onSubmit={async amount => setAims(previous => [...previous.filter(aim => aim.ref !== mirrorCategory(editor.trait)), { ...fixtureAim(amount ?? 100.25), ref: mirrorCategory(editor.trait)! }])} />}
  </div>;
}
