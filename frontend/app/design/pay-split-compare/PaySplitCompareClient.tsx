"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Info, RotateCcw } from "lucide-react";
import SpendShapeCard from "@/components/SpendShapeCard";
import MoneyShapeHero from "@/app/spend/shape/MoneyShapeHero";
import MoneyText from "@/components/MoneyText";
import { SheetFrame } from "@/components/SheetFrame";
import { GUIDES, PREVIEW_REFERENCE_KEY, compareShape, differenceLabel, guideFor, money, signedMoney, type Guide, type GuideId, type SectionId } from "./comparison";
import { SCENARIOS, scenarioFor, type Scenario } from "./fixtures";
import s from "./compare.module.css";

const subscribe = (fn: () => void) => {
  window.addEventListener("storage", fn);
  return () => window.removeEventListener("storage", fn);
};
function readGuide(): GuideId | null {
  try {
    const value = localStorage.getItem(PREVIEW_REFERENCE_KEY);
    return GUIDES.find(guide => guide.id === value)?.id ?? null;
  } catch { return null; }
}
function useGuide() {
  const saved = useSyncExternalStore(subscribe, readGuide, () => null);
  const [session, setSession] = useState<GuideId | null>(null);
  const [saveError, setSaveError] = useState(false);
  const choose = useCallback((id: GuideId) => {
    setSession(id);
    try { localStorage.setItem(PREVIEW_REFERENCE_KEY, id); setSaveError(false); }
    catch { setSaveError(true); }
  }, []);
  return { id: session ?? saved ?? "50-30-20", choose, saveError };
}

function GuidePicker({ id, choose }: { id: GuideId; choose: (id: GuideId) => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" aria-label="Choose a reference" aria-haspopup="dialog" className={s.referenceButton} onClick={() => setOpen(true)}>
      <span><small>Compare with</small><strong>{guideFor(id).name}</strong></span><ChevronRight size={16} aria-hidden="true" />
    </button>
    {open && <SheetFrame title="Choose a reference" description="General guides, not a personal budget. This only changes the preview." onClose={() => setOpen(false)} bodyClassName="px-5 py-3">
      <fieldset className={s.guideList}>
        <legend className="sr-only">Reference choice</legend>
        {GUIDES.map(guide => <label className={s.guideRow} key={guide.id}>
          <input type="radio" name="g279-guide" checked={guide.id === id} onChange={() => { choose(guide.id); setOpen(false); }} />
          <span><strong>{guide.name}</strong><small>{guide.description}</small></span>
        </label>)}
      </fieldset>
    </SheetFrame>}
  </>;
}

function Evidence({ section, scenario, guide, close }: { section: SectionId; scenario: Scenario; guide: Guide; close: () => void }) {
  const row = compareShape(scenario.shape, guide).rows.find(item => item.id === section);
  return <SheetFrame title={(row?.label ?? section) + " evidence"} description="Illustrative breakdown, not your live payments." onClose={close} bodyClassName="px-5 py-4">
    <div className={s.evidence}>
      {scenario.drivers[section].map(driver => <div key={driver.label}><span>{driver.label}</span><MoneyText text={money(driver.amount)} /></div>)}
    </div>
    {row && <>
      <div className={s.evidenceTotal}><strong>{row.label} total</strong><MoneyText text={money(row.actual)} /></div>
      {row.guide !== null && <div className={s.evidenceWorking}>
        <p><span>This reference</span><MoneyText text={money(row.guide)} /></p>
        <p><span>Difference</span><MoneyText text={signedMoney(row.delta ?? 0)} /></p>
      </div>}
    </>}
    <p className={s.sheetNote}>These example amounts add up to the section total. A live version needs the matching period’s category and payment evidence; these are not fetched from your accounts.</p>
  </SheetFrame>;
}

function Explanation({ close }: { close: () => void }) {
  return <SheetFrame title="How comparison works" onClose={close} bodyClassName="px-5 py-4">
    <div className={s.explanation}>
      <h3>One income base</h3>
      <p>Your actual amounts come from transactions. Each reference amount is a share of what came in. The original bar’s percentages instead use all outgoings when they exceed income.</p>
      <h3>An approximate mapping</h3>
      <p>50/30/20 describes needs, wants, and savings or debt payments. Sorted uses Fixed, Free and Moved. They are not exact equivalents: Fixed includes loan repayments and commitments; Moved can include transfers between your own accounts.</p>
      <p>Here, 50% is compared with Fixed, 30% with Free and 20% with Moved. This is an adapted illustration, not an assessment of what you need or should spend.</p>
      <h3>The other references</h3>
      <p>The Conscious Spending Plan choice is one 60/20/20 example: 60% Fixed, 20% Free and 20% Moved. Its wider ranges vary, so being above this example does not mean being outside the whole framework.</p>
      <p>Pay yourself first is a principle, not a fixed percentage split. It has no numeric comparison here.</p>
      <h3>What a difference means</h3>
      <p>A section above a reference is not necessarily responsible for money going beyond income. Money moved above a reference is not labelled overspending. Nothing here sets a budget, moves money or asks you to change a habit.</p>
      <a href="https://files.consumerfinance.gov/f/201603_cfpb_rules-to-live-by_my-spending-rule-to-live-by.pdf" target="_blank" rel="noopener noreferrer">CFPB spending rule worksheet</a>
      <a href="https://www.iwillteachyoutoberich.com/conscious-spending-basics/" target="_blank" rel="noopener noreferrer">Conscious Spending Basics</a>
    </div>
  </SheetFrame>;
}

type Compared = ReturnType<typeof compareShape>;
function PairedBars({ comparison, guide }: { comparison: Compared; guide: Guide }) {
  if (!guide.shares) return null;
  const scale = Math.max(comparison.income, comparison.totalOut);
  const groups = [
    { label: "Your split", parts: comparison.rows.map(row => ({ id: row.id, amount: row.actual })), left: comparison.left },
    { label: guide.shortName, parts: comparison.rows.map(row => ({ id: row.id, amount: row.guide ?? 0 })), left: 0 },
  ];
  return <div className={s.pairedBars} aria-label="Paired actual and reference bars">
    {groups.map(group => <div className={s.barGroup} key={group.label}>
      <span>{group.label}</span>
      <div className={s.stackedBar} aria-hidden="true">
        {group.parts.map(part => <i key={part.id} className={s[part.id]} style={{ width: String(part.amount / scale * 100) + "%" }} />)}
        {group.left > 0 && <i className={s.left} style={{ width: String(group.left / scale * 100) + "%" }} />}
        <span className={s.incomeTick} style={{ left: String(comparison.income / scale * 100) + "%" }} />
      </div>
    </div>)}
    <p>Same pound scale; the tick marks <MoneyText text={money(comparison.income)} /> income. Colours match the pay-split bar.</p>
  </div>;
}

function ComparisonRows({ comparison, guide, variant, open }: { comparison: Compared; guide: Guide; variant: "a" | "b"; open: (id: SectionId) => void }) {
  const rows = variant === "b" ? [...comparison.rows].sort((a, b) => Number(a.id === "moved") - Number(b.id === "moved") || Number(b.aboveCost) - Number(a.aboveCost) || Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0)) : comparison.rows;
  return <div className={s.rows}>
    {rows.map(row => <div className={s.row} key={row.id}>
      <button type="button" aria-label={"View " + row.label + " evidence"} onClick={() => open(row.id)}>
        <span className={s.rowTitle}><i className={s[row.id]} aria-hidden="true" /><strong>{row.label}</strong>{row.aboveCost && <i className={s.warning} aria-hidden="true" />}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      {guide.shares ? <>
        <div className={s.amounts}>
          <span><small>Your amount</small><MoneyText text={money(row.actual)} /></span>
          <span><small>{row.guideShare}% guide</small><MoneyText text={money(row.guide ?? 0)} /></span>
          <span><small>Difference</small><MoneyText text={signedMoney(row.delta ?? 0)} /></span>
        </div>
        <p className={s.rowReading}>{differenceLabel(row)}</p>
      </> : <div className={s.principleRow}><span>Moved or spent this period</span><MoneyText text={money(row.actual)} /></div>}
    </div>)}
  </div>;
}

export default function PaySplitCompareClient() {
  const search = useSearchParams();
  const router = useRouter();
  const view = search.get("view") === "detail" ? "detail" : "card";
  const variant = search.get("variant") === "b" ? "b" : "a";
  const scenario = scenarioFor(search.get("scenario") ?? search.get("state"));
  const guideState = useGuide();
  const guide = guideFor(guideState.id);
  const comparison = useMemo(() => compareShape(scenario.shape, guide), [scenario, guide]);
  const [evidence, setEvidence] = useState<SectionId | null>(null);
  const [explain, setExplain] = useState(false);
  const dark = search.get("mode") === "dark";
  const loadError = search.get("state") === "load-error";
  useEffect(() => {
    const previousDark = document.documentElement.classList.contains("dark");
    const previousScheme = document.documentElement.style.colorScheme;
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    return () => { document.documentElement.classList.toggle("dark", previousDark); document.documentElement.style.colorScheme = previousScheme; };
  }, [dark]);
  const update = (values: Record<string, string>) => {
    const params = new URLSearchParams(search.toString());
    Object.entries(values).forEach(([key, value]) => params.set(key, value));
    if (values.scenario) params.delete("state");
    router.replace("?" + params, { scroll: false });
  };
  const intercept = (event: React.MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    if (!link) return;
    event.preventDefault();
    const label = link.getAttribute("aria-label") ?? "";
    const section: SectionId | null = label.startsWith("Fixed") ? "fixed" : label.startsWith("Moved") ? "moved" : label.startsWith("Free") ? "free" : null;
    if (section) setEvidence(section); else setExplain(true);
  };
  const lead = comparison.largestOver;
  return <main className={s.preview}>
    <div className={s.shell}>
      <header className={s.header}>
        <Link href="/design">Design previews</Link>
        <h1>Pay-split comparison</h1>
        <p>G279 · Illustrative figures, not your account data.</p>
      </header>
      <nav className={s.controls} aria-label="Preview controls">
        <div>{(["a", "b"] as const).map(id => <button key={id} type="button" aria-pressed={variant === id} onClick={() => update({ variant: id })}>{id === "a" ? "A · Paired" : "B · Difference"}</button>)}</div>
        <div>{(["card", "detail"] as const).map(id => <button key={id} type="button" aria-pressed={view === id} onClick={() => update({ view: id })}>{id === "card" ? "Spend card" : "Drill-in"}</button>)}<button type="button" onClick={() => update({ mode: dark ? "light" : "dark" })}>{dark ? "Light mode" : "Dark mode"}</button></div>
        <div className={s.cases} aria-label="Illustrative scenario">{SCENARIOS.map(item => <button key={item.id} type="button" aria-pressed={scenario.id === item.id} onClick={() => update({ scenario: item.id })}>{({ under: "Within guide", fixed: "Fixed over", free: "Free over", beyond: "Beyond", thin: "First period" })[item.id]}</button>)}</div>
      </nav>
      {loadError ? <section className={s.error} role="alert">
        <h2>Could not load this example</h2><p>No comparison is shown until the figures are available.</p>
        <button type="button" onClick={() => { const params = new URLSearchParams(search.toString()); params.delete("state"); router.replace("?" + params); }}>Try again</button>
      </section> : <div className={view === "detail" ? s.detailGrid : s.cardStage}>
        <section className={s.instrument} aria-label="Existing pay-split instrument" onClickCapture={intercept}>
          {view === "card" && scenario.shape.status === "thin" ? <MoneyShapeHero shape={scenario.shape} /> : view === "card" ? <SpendShapeCard shape={scenario.shape} hideValues={false} onOpen={() => update({ view: "detail" })} /> : <MoneyShapeHero shape={scenario.shape} />}
        </section>
        <section className={s.comparison} aria-label="Reference comparison" aria-live="polite">
          <GuidePicker id={guideState.id} choose={guideState.choose} />
          {!comparison.available ? <div className={s.unavailable}><h2>No comparison yet</h2><p>A completed pay period is needed. Nothing has been treated as zero.</p></div> : <>
            <div className={s.comparisonHead}>
              <h2>{!guide.shares ? "A principle, not a percentage" : variant === "b" && lead ? lead.label + " is furthest above this guide" : variant === "b" ? "Neither cost group is above this guide" : view === "card" ? "How each section compares" : "Your amounts beside the guide"}</h2>
              <button type="button" className={s.iconButton} aria-label="How comparison works" onClick={() => setExplain(true)}><Info size={17} aria-hidden="true" /></button>
            </div>
            <p className={s.baseNote}>{guide.shares ? <>Reference based on <MoneyText text={money(comparison.income)} /> income, not total outgoings.</> : <>Income this period: <MoneyText text={money(comparison.income)} />.</>}</p>
            {!guide.shares ? <p className={s.baseNote}>Pay yourself first sets no fixed split. Your amounts are shown without over/under markers.</p> : variant === "b" && lead && <p className={s.lead}><i className={s.warning} aria-hidden="true" /><MoneyText text={money(lead.delta ?? 0)} /><span>above the {lead.label} reference</span></p>}
            {view === "detail" ? <>
              {variant === "a" && <PairedBars comparison={comparison} guide={guide} />}
              <ComparisonRows comparison={comparison} guide={guide} variant={variant} open={setEvidence} />
              {comparison.beyond > 0 && <div className={s.working}>
                <strong>{guide.shares ? "How the differences add up" : "Outgoings beyond income"}</strong>
                {guide.shares && comparison.rows.map(row => <p key={row.id}><span>{row.label}</span><MoneyText text={signedMoney(row.delta ?? 0)} /></p>)}
                <p className={s.workingTotal}><span>Beyond income</span><MoneyText text={money(comparison.beyond)} /></p>
                <small>{guide.shares ? "The net difference is the same as outgoings minus income. It does not identify which payments funded the gap." : "Outgoings minus income. There is no numeric reference for this principle."}</small>
              </div>}
              <details className={s.details}><summary>How the groups compare<ChevronDown size={16} aria-hidden="true" /></summary><p>Fixed roughly maps to needs, Free to wants, and Moved to savings. These are not exact matches; Moved can include your own transfers. This is general information, not advice.</p><button type="button" onClick={() => setExplain(true)}>Read the mapping and sources</button></details>
            </> : <>
              {guide.shares && <div className={s.compactRows}>{comparison.rows.map(row => <button key={row.id} type="button" aria-label={"View " + row.label + " evidence"} onClick={() => setEvidence(row.id)}><span>{row.label}{row.aboveCost && <i className={s.warning} aria-hidden="true" />}</span><MoneyText text={signedMoney(row.delta ?? 0)} /><small>{row.id === "moved" ? "moved vs guide" : row.delta! > 0 ? "above guide" : row.delta! < 0 ? "below guide" : "matches guide"}</small></button>)}</div>}
              <button type="button" className={s.viewComparison} onClick={() => update({ view: "detail" })}>View the comparison and breakdown <ChevronRight size={16} aria-hidden="true" /></button>
              <button type="button" className={s.explainLink} onClick={() => setExplain(true)}>Approximate mapping · how it works</button>
            </>}
          </>}
        </section>
      </div>}
      <div className={s.previewNote}>
        <p role={guideState.saveError ? "status" : undefined}>{guideState.saveError ? "Not saved on this device. Your choice is kept for this open preview." : "Reference choice is remembered only in this preview on this browser."}</p>
        <button type="button" onClick={() => guideState.choose("50-30-20")}><RotateCcw size={14} aria-hidden="true" />Reset reference</button>
      </div>
    </div>
    {evidence && <Evidence section={evidence} scenario={scenario} guide={guide} close={() => setEvidence(null)} />}
    {explain && <Explanation close={() => setExplain(false)} />}
  </main>;
}
