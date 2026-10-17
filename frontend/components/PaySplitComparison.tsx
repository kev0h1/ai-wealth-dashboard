"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Info } from "lucide-react";
import { DisclosureSummary } from "./Disclosure";
import type { MoneyShape } from "@/lib/api";
import { GUIDES, compareShape, differenceLabel, guideFor, money, signedMoney, type Guide, type GuideId, type SectionId } from "@/lib/paySplitReference";
import { usePreferences } from "@/components/PreferencesContext";
import MoneyText from "@/components/MoneyText";
import { SheetFrame } from "@/components/SheetFrame";
import s from "./PaySplitComparison.module.css";

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

function Explanation({ close }: { close: () => void }) {
  return <SheetFrame title="How comparison works" onClose={close} bodyClassName="px-5 py-4">
    <div className={s.explanation}>
      <h3>50/30/20 is the default</h3>
      <p>The default comparison is 50% Fixed, 30% Free and 20% Moved. It only changes when you choose another reference.</p>
      <h3>One income base</h3>
      <p>Each reference amount is a share of what came in. The original bar’s percentages instead use all outgoings when they exceed income.</p>
      <h3>An approximate mapping</h3>
      <p>50/30/20 describes needs, wants, and savings or debt payments. Sorted uses Fixed, Free and Moved. They are not exact equivalents: Fixed includes loan repayments and commitments; Moved can include transfers between your own accounts.</p>
      <p>This is an adapted illustration, not an assessment of what you need or should spend.</p>
      <h3>The alternatives</h3>
      <p>The Conscious Spending Plan option is one 60/20/20 example: 60% Fixed, 20% Free and 20% Moved. Its wider ranges vary, so being above this example does not mean being outside the whole framework. It is not the default 50/30/20 reference.</p>
      <p>Pay yourself first is a principle, not a fixed percentage split. It has no numeric comparison here.</p>
      <h3>What a difference means</h3>
      <p>A section above a reference is not necessarily responsible for money going beyond income. Money moved above a reference is not labelled overspending. Nothing here sets a budget, moves money or asks you to change a habit.</p>
      <a href="https://files.consumerfinance.gov/f/201603_cfpb_rules-to-live-by_my-spending-rule-to-live-by.pdf" target="_blank" rel="noopener noreferrer">CFPB spending rule worksheet</a>
      <a href="https://www.iwillteachyoutoberich.com/conscious-spending-basics/" target="_blank" rel="noopener noreferrer">Conscious Spending Basics</a>
    </div>
  </SheetFrame>;
}

function Evidence({ section, shape, guide, average, close }: { section: SectionId; shape: MoneyShape; guide: Guide; average: boolean; close: () => void }) {
  const row = compareShape(shape, guide).rows.find(item => item.id === section);
  const drivers = shape.jobs?.find(job => job.id === section)?.drivers;
  const reconciles = !!row && !!drivers && drivers.every(driver => Number.isFinite(driver.amount)) && Math.abs(drivers.reduce((sum, driver) => sum + driver.amount, 0) - row.actual) < .005;
  const params = new URLSearchParams();
  if (shape.period?.start) params.set("from", shape.period.start);
  if (shape.period?.end) params.set("to", shape.period.end);
  return <SheetFrame title={(row?.label ?? section) + " breakdown"} description={(average ? "Average per pay period · " : "") + (shape.period?.label ?? "Selected pay period")} onClose={close} bodyClassName="px-5 py-4" footer={shape.period?.start && shape.period?.end ? <Link href={"/transactions?" + params} className={s.transactions}>Browse transactions in this date range <ChevronRight size={16} aria-hidden="true" /></Link> : undefined}>
    {reconciles ? <div className={s.evidence}>
      {drivers.map((driver, index) => <div key={String(driver.category) + index}><span>{driver.category ?? (section === "moved" ? "Other movements and rounding" : "Rounding difference")}</span><MoneyText text={driver.amount < 0 ? signedMoney(driver.amount) : money(driver.amount)} /></div>)}
    </div> : <p className={s.sheetNote}>The category breakdown is not available for this selection yet. No payments have been estimated.</p>}
    {row && <>
      <div className={s.evidenceTotal}><strong>{row.label} total</strong><MoneyText text={money(row.actual)} /></div>
      {row.guide !== null && <div className={s.evidenceWorking}>
        <p><span>This reference</span><MoneyText text={money(row.guide)} /></p>
        <p><span>Difference</span><MoneyText text={signedMoney(row.delta ?? 0)} /></p>
      </div>}
    </>}
    <p className={s.sheetNote}>{average ? "Category amounts are means across the same completed pay periods as the comparison, not totals for the whole date range. " : "Category amounts use the same completed pay period as the comparison. "}Spending is net of refunds. The transaction list includes all activity in the date range, not just this section.</p>
  </SheetFrame>;
}

export default function PaySplitComparison({ shape, view = "detail", average = false, reference, onReferenceChange, hideValues }: {
  shape: MoneyShape;
  view?: "card" | "detail";
  average?: boolean;
  /** Controlled props keep local fixture renders inert. Production uses
   * the shared authenticated preference, never preview localStorage. */
  reference?: GuideId;
  onReferenceChange?: (id: GuideId) => void;
  hideValues?: boolean;
}) {
  const prefs = usePreferences();
  const [picker, setPicker] = useState(false);
  const [evidence, setEvidence] = useState<SectionId | null>(null);
  const [explain, setExplain] = useState(false);
  const controlled = reference !== undefined;
  const ready = controlled || (prefs.preferencesReady && prefs.rawPrefs !== null);
  const masked = hideValues ?? (prefs.hideNetWorth || !prefs.preferencesReady);
  const guide = guideFor(controlled ? reference : prefs.paySplitReference);
  const comparison = compareShape(shape, guide);
  const error = !controlled && prefs.preferencesSaveError?.field === "pay_split_reference" ? prefs.preferencesSaveError.message : null;
  const choose = (id: GuideId) => {
    if (controlled) onReferenceChange?.(id); else prefs.setPaySplitReference(id);
    setPicker(false);
  };
  return <section className={s.comparison} aria-label="Reference comparison">
    <button type="button" aria-label={ready ? "Choose a reference, current: " + guide.name : "Saved reference not loaded"} aria-haspopup="dialog" disabled={!ready} className={s.referenceButton} onClick={() => setPicker(true)}>
      <span><small>Compare with</small><strong>{ready ? guide.name : prefs.preferencesReady ? "Saved reference unavailable" : "Loading saved reference…"}</strong></span><ChevronRight size={16} aria-hidden="true" />
    </button>
    {error && <p className={s.saveError} role="status"><i className={s.warning} aria-hidden="true" />{error} Choose the reference again to retry.</p>}
    {!ready ? <div className={s.unavailable}><p>{prefs.preferencesReady ? "Could not load your saved reference." : "Checking your saved reference."}</p>{prefs.preferencesReady && <button type="button" className={s.explainLink} onClick={() => { void prefs.refreshPreferences().catch(() => {}); }}>Try again</button>}</div> : masked ? <p className={s.baseNote}>Comparison amounts are hidden while Hide balances is on.</p> : !comparison.available ? <div className={s.unavailable}><h2>No comparison yet</h2><p>A completed pay period with income and a complete split is needed. Nothing has been treated as zero.</p></div> : <>
      <div className={s.comparisonHead}>
        <h2>{!guide.shares ? "A principle, not a percentage" : view === "card" ? "How each section compares" : "Your amounts beside the guide"}</h2>
        <button type="button" className={s.iconButton} aria-label="How comparison works" onClick={() => setExplain(true)}><Info size={17} aria-hidden="true" /></button>
      </div>
      <p className={s.baseNote}>{average ? "Average per pay period. " : ""}{guide.shares ? <>Reference based on <MoneyText text={money(comparison.income)} /> income, not total outgoings.</> : <>Income this period: <MoneyText text={money(comparison.income)} />.</>}</p>
      {!guide.shares && <p className={s.baseNote}>Pay yourself first sets no fixed split. Your amounts are shown without over/under markers.</p>}
      {view === "detail" ? <>
        <PairedBars comparison={comparison} guide={guide} />
        <div className={s.rows}>{comparison.rows.map(row => <div className={s.row} key={row.id}>
          <button type="button" aria-label={"View " + row.label + " breakdown"} onClick={() => setEvidence(row.id)}><span className={s.rowTitle}><i className={s[row.id]} aria-hidden="true" /><strong>{row.label}</strong>{row.aboveCost && <i className={s.warning} aria-hidden="true" />}</span><ChevronRight size={16} aria-hidden="true" /></button>
          {guide.shares ? <><div className={[s.amounts, [money(row.actual), money(row.guide ?? 0), signedMoney(row.delta ?? 0)].some(value => value.length > 10) ? s.longAmounts : ""].join(" ")}><span><small>Your amount</small><MoneyText text={money(row.actual)} /></span><span><small>{row.guideShare}% guide</small><MoneyText text={money(row.guide ?? 0)} /></span><span><small>Difference</small><MoneyText text={signedMoney(row.delta ?? 0)} /></span></div><p className={s.rowReading}>{differenceLabel(row)}</p></> : <div className={s.principleRow}><span>Moved or spent this period</span><MoneyText text={money(row.actual)} /></div>}
        </div>)}</div>
        {comparison.beyond > 0 && <div className={s.working}>
          <strong>{guide.shares ? "How the differences add up" : "Outgoings beyond income"}</strong>
          {guide.shares && comparison.rows.map(row => <p key={row.id}><span>{row.label}</span><MoneyText text={signedMoney(row.delta ?? 0)} /></p>)}
          <p className={s.workingTotal}><span>Beyond income</span><MoneyText text={money(comparison.beyond)} /></p>
          <small>{guide.shares ? "The net difference is the same as outgoings minus income. It does not identify which payments funded the gap." : "Outgoings minus income. There is no numeric reference for this principle."}</small>
        </div>}
        <details className={s.details}><DisclosureSummary className="items-center gap-3">How the groups compare</DisclosureSummary><p>Fixed roughly maps to needs, Free to wants, and Moved to savings. These are not exact matches; Moved can include your own transfers. This is general information, not advice.</p><button type="button" onClick={() => setExplain(true)}>Read the mapping and sources</button></details>
      </> : <>
        {guide.shares && <div className={[s.compactRows, comparison.rows.some(row => signedMoney(row.delta ?? 0).length > 10) ? s.compactLong : ""].join(" ")}>{comparison.rows.map(row => <button key={row.id} type="button" aria-label={"View " + row.label + " breakdown"} onClick={() => setEvidence(row.id)}><span>{row.label}{row.aboveCost && <i className={s.warning} aria-hidden="true" />}</span><MoneyText text={signedMoney(row.delta ?? 0)} /><small>{row.id === "moved" ? "moved vs guide" : row.delta! > 0 ? "above guide" : row.delta! < 0 ? "below guide" : "matches guide"}</small></button>)}</div>}
        <Link className={s.viewComparison} href="/spend/shape">View the comparison and breakdown <ChevronRight size={16} aria-hidden="true" /></Link>
        <button type="button" className={s.explainLink} onClick={() => setExplain(true)}>Approximate mapping · how it works</button>
      </>}
    </>}
    {picker && <SheetFrame title="Choose a reference" description="50/30/20 is the default. Choosing an alternative changes only this comparison, not a budget or bank payment." onClose={() => setPicker(false)} bodyClassName="px-5 py-3"><fieldset className={s.guideList}><legend className="sr-only">Reference choice</legend>{GUIDES.map(item => <label className={s.guideRow} key={item.id}><input type="radio" name="pay-split-reference" checked={item.id === guide.id} onChange={() => choose(item.id)} /><span><strong>{item.name}</strong><small>{item.description}</small></span></label>)}</fieldset></SheetFrame>}
    {evidence && ready && !masked && <Evidence section={evidence} shape={shape} guide={guide} average={average} close={() => setEvidence(null)} />}
    {explain && <Explanation close={() => setExplain(false)} />}
  </section>;
}
