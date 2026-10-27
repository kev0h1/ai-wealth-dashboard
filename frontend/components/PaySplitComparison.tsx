"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { MoneyShape } from "@/lib/api";
import { GUIDES, compareShape, guideFor, money, signedMoney, referenceAmount, referenceShare, type ComparisonRow, type Guide, type GuideId, type SectionId } from "@/lib/paySplitReference";
import { usePreferences } from "@/components/PreferencesContext";
import MoneyText from "@/components/MoneyText";
import { SheetFrame } from "@/components/SheetFrame";
import s from "./PaySplitComparison.module.css";

type Compared = ReturnType<typeof compareShape>;

function PairedBars({ comparison, guide }: { comparison: Compared; guide: Guide }) {
  if (!guide.shares) return null;
  const scale = Math.max(comparison.income, comparison.totalOut);
  const groups = [
    { label: "Your amounts", parts: comparison.rows.map(row => ({ id: row.id, amount: row.actual })), left: comparison.left },
    { label: guide.name, parts: comparison.rows.map(row => ({ id: row.id, amount: row.guide ?? 0 })), left: 0 },
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
    <p>The line marks your income. Both bars use the same pound scale.</p>
  </div>;
}

function reading(row: ComparisonRow): string {
  if (row.delta === null) return "";
  const percent = row.guideShare !== null ? `${row.guideShare}%` : `${row.guideShareMin} to ${row.guideShareMax}%`;
  if (row.guide === null) return `${row.delta === 0 ? "within" : row.delta > 0 ? "above" : "below"} ${percent} range`;
  return `${row.delta === 0 ? "matches" : row.delta > 0 ? "above" : "below"} ${percent} example`;
}

function rangePercent(row: ComparisonRow) {
  return `${row.guideShareMin} to ${row.guideShareMax}%`;
}
function rangeStatus(row: ComparisonRow) {
  return row.delta === 0 ? "Within range" : signedMoney(row.delta ?? 0) + (row.delta! > 0 ? " above range" : " below range");
}

function SavingIdea() {
  return <div className={s.prose}>
    <p>Saving before spending means putting money aside when you get paid, then planning other spending around what remains.</p>
    <p>This budgeting approach is often called “pay yourself first”. You choose the amount to save.</p>
  </div>;
}
function Help({ reference }: { reference: GuideId }) {
  return <details className={s.help}>
    <summary>{reference === "first" ? "What do these groups mean?" : "How this comparison works"}<ChevronDown size={16} aria-hidden="true" /></summary>
    <div className={s.prose}>
      {reference === "50-30-20" && <><p>The original 50/30/20 idea uses 50% of income for needs, 30% for wants and 20% for savings or paying off debt.</p><p>Sorted uses Fixed, Free and Moved as rough matches. The example is not a judgement about which payments you need.</p><p>A plus means more than the example amount. A minus means less.</p></>}
      {reference === "conscious" && <><p>These examples use 50 to 60% of income for Fixed, 10 to 20% for Moved, and 20 to 35% for Free.</p><p>Each range stands on its own. They do not form a single split that adds up to 100%. An amount inside its range has no difference.</p></>}
      <dl><dt>Fixed</dt><dd>Bills and basics, including groceries and transport.</dd><dt>Moved</dt><dd>Money moved to savings or investing. This can include transfers between your accounts, so it does not measure how much your savings grew.</dd><dt>Free</dt><dd>Other spending recorded in this period. It is not money still available to spend.</dd></dl>
      {reference !== "first" && <p>The comparison uses income. The pay-split bar can use total outgoings when more went out than came in, so its percentages can differ.</p>}

    </div>
  </details>;
}

function Evidence({ section, shape, guide, average, close }: { section: SectionId; shape: MoneyShape; guide: Guide; average: boolean; close: () => void }) {
  const row = compareShape(shape, guide).rows.find(item => item.id === section);
  const drivers = shape.jobs?.find(job => job.id === section)?.drivers;
  const reconciles = !!row && !!drivers && drivers.every(driver => Number.isFinite(driver.amount)) && Math.abs(drivers.reduce((sum, driver) => sum + driver.amount, 0) - row.actual) < .005;
  const params = new URLSearchParams();
  if (shape.period?.start) params.set("from", shape.period.start);
  if (shape.period?.end) params.set("to", shape.period.end);
  const categories = <>
      {reconciles ? drivers.length ? <div className={s.evidence}>
        {drivers.map((driver, index) => <div key={String(driver.category) + index}><span>{driver.category ?? (section === "moved" ? "Other movements and rounding" : "Rounding difference")}</span><MoneyText text={driver.amount < 0 ? signedMoney(driver.amount) : money(driver.amount)} /></div>)}
      </div> : <p className={s.sheetNote}>No payments in this group.</p> : <p className={s.sheetNote}>The category breakdown is not available for this selection yet. No payments have been estimated.</p>}
      {row && <div className={s.evidenceTotal}><strong>{row.label} total</strong><MoneyText text={money(row.actual)} /></div>}
  </>;
  return <SheetFrame title={(row?.label ?? section) + " breakdown"} description={(average ? "Average per pay period · " : "") + (shape.period?.label ?? "Selected pay period")} onClose={close} bodyClassName="px-5 py-4" footer={shape.period?.start && shape.period?.end ? <Link href={"/transactions?" + params} className={s.transactions}>Browse transactions in this date range <ChevronRight size={16} aria-hidden="true" /></Link> : undefined}>
    {row && guide.ranges && <div className={s.rangeWorking}>
      <dl><div><dt>Your amount</dt><dd><MoneyText text={money(row.actual)} /></dd></div><div><dt>Guide {rangePercent(row)}</dt><dd><MoneyText text={referenceAmount(row)} /></dd></div></dl>
      <p className={s.rangeStatus}><MoneyText text={rangeStatus(row)} /></p>
      <p className={s.baseNote}><MoneyText text={(average ? "The guide uses your average income of " : "The guide uses your income of ") + money(shape.take_home) + ". Each range stands on its own."} /></p>
    </div>}
    {guide.ranges ? <details className={s.categories}>
      <summary tabIndex={0}>What is in this amount<ChevronDown size={16} aria-hidden="true" /></summary>
      {categories}
    </details> : categories}
    {section === "moved" && <p className={s.sheetNote}>Moved can include transfers between your own accounts. It does not measure how much your savings grew.</p>}
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
  const controlled = reference !== undefined;
  const ready = controlled || (prefs.preferencesReady && prefs.rawPrefs !== null);
  const masked = hideValues ?? (prefs.hideNetWorth || !prefs.preferencesReady);
  const guide = guideFor(controlled ? reference : prefs.paySplitReference);
  const comparison = compareShape(shape, guide);
  const numeric = !!(guide.shares || guide.ranges);
  const compactAmount = (row: ComparisonRow) => guide.shares ? signedMoney(row.delta ?? 0) : money(row.actual);
  const error = !controlled && prefs.preferencesSaveError?.field === "pay_split_reference" ? prefs.preferencesSaveError.message : null;
  const choose = (id: GuideId) => {
    if (controlled) onReferenceChange?.(id); else prefs.setPaySplitReference(id);
    setPicker(false);
  };
  return <section className={s.comparison} aria-label="Reference comparison">
    <button type="button" aria-label={ready ? "Choose a view, current: " + guide.name : "Saved view not loaded"} aria-haspopup="dialog" disabled={!ready} className={s.referenceButton} onClick={() => setPicker(true)}>
      <span><small>Explore your pay</small><strong>{ready ? guide.name : prefs.preferencesReady ? "Saved view unavailable" : "Loading your view…"}</strong></span><ChevronRight size={16} aria-hidden="true" />
    </button>
    {error && <p className={s.saveError} role="status">{error} Choose the view again to retry.</p>}
    {ready && !numeric && <SavingIdea />}
    {!ready ? <div className={s.unavailable}><p>{prefs.preferencesReady ? "Could not load your saved view." : "Checking your saved view…"}</p>{prefs.preferencesReady && <button type="button" className={s.explainLink} onClick={() => { void prefs.refreshPreferences().catch(() => {}); }}>Try again</button>}</div> : masked ? <p className={s.baseNote}>Comparison amounts are hidden while Hide balances is on.</p> : !comparison.available ? <div className={s.unavailable}><h2>No comparison yet</h2><p>A completed pay period with income and a complete split is needed. Nothing has been treated as zero.</p></div> : <>
      {!(view === "detail" && guide.ranges) && <div className={s.comparisonHead}>
        <h2 className={!numeric ? s.subheading : undefined}>{view === "detail" ? !numeric ? "Your recorded amounts" : "Your amounts and the example" : guide.shares ? "Difference from the example" : average ? "Your average amounts" : "Your amounts this period"}</h2>
      </div>}
      <p className={s.baseNote}><MoneyText text={(average ? "Average income per pay period: " : "Income for this pay period: ") + money(comparison.income) + "."} /></p>
      {view === "detail" ? <>
        <PairedBars comparison={comparison} guide={guide} />
        {guide.ranges ? <ul className={s.rangeRows}>{comparison.rows.map(row => <li key={row.id}>
          <button type="button" aria-label={"View " + row.label + " comparison. Your amount " + money(row.actual) + ". Guide " + rangePercent(row) + ". " + rangeStatus(row)} onClick={() => setEvidence(row.id)}>
            <span className={s.rangeHead}><span className={s.rowTitle}><i className={s[row.id]} aria-hidden="true" /><strong>{row.label}</strong></span><span className={s.rangeValue}><MoneyText text={money(row.actual)} /><ChevronRight size={15} aria-hidden="true" /></span></span>
            <span className={s.rangeSub}><span>Guide {rangePercent(row)}</span><MoneyText className={s.rangeReading} text={rangeStatus(row)} /></span>
          </button>
        </li>)}</ul> : <>
        <div className={s.rows}>{comparison.rows.map(row => <div className={s.row} key={row.id}>
          <button type="button" aria-label={"View " + row.label + " breakdown"} onClick={() => setEvidence(row.id)}><span className={s.rowTitle}><i className={s[row.id]} aria-hidden="true" /><strong>{row.label}</strong></span><ChevronRight size={16} aria-hidden="true" /></button>
          {numeric ? <><div className={[s.amounts, [money(row.actual), referenceAmount(row), signedMoney(row.delta ?? 0)].some(value => value.length > 10) ? s.longAmounts : ""].join(" ")}><span><small>Your amount</small><MoneyText text={money(row.actual)} /></span><span><small>{referenceShare(row).replace(" guide", " example")}</small><span className={s.referenceRange}><MoneyText text={referenceAmount(row)} /></span></span><span><small>Difference</small><MoneyText text={signedMoney(row.delta ?? 0)} /></span></div><p className={s.rowReading}>{reading(row)}</p></> : <div className={s.principleRow}><span>Your amount</span><MoneyText text={money(row.actual)} /></div>}
        </div>)}</div></>}

        {comparison.beyond > 0 && !guide.ranges && <div className={s.cashflow}><strong>More went out than came in</strong><MoneyText text={money(comparison.beyond)} /><p>This compares all money spent or moved with income.</p></div>}

      </> : <>
        <div className={[s.compactRows, comparison.rows.some(row => compactAmount(row).length > 10) ? s.compactLong : ""].join(" ")}>{comparison.rows.map(row => <button key={row.id} type="button" aria-label={"View " + row.label + " breakdown"} onClick={() => setEvidence(row.id)}><span>{row.label}</span><MoneyText text={compactAmount(row)} />{numeric && <small>{reading(row)}</small>}</button>)}</div>
      </>}
      {!numeric && <p className={s.note}>Moved can include transfers between your accounts. These amounts cannot tell whether savings were set aside first.</p>}
      {view === "card" && <Link className={s.viewComparison} href="/spend/shape">See full breakdown <ChevronRight size={16} aria-hidden="true" /></Link>}
    </>}
    {ready && <Help reference={guide.id} />}
    {picker && <SheetFrame title="Choose a way to look at your pay" description="This choice only changes this view. It will not create a budget or move money." onClose={() => setPicker(false)} bodyClassName="px-5 py-3">{({ closeThen }) => <fieldset className={s.guideList}><legend className="sr-only">View choice</legend>{GUIDES.map(item => <label className={s.guideRow} key={item.id}><input type="radio" name="pay-split-reference" checked={item.id === guide.id} onChange={() => closeThen(() => choose(item.id))} /><span><strong>{item.name}</strong><small>{item.description}</small></span></label>)}</fieldset>}</SheetFrame>}

    {evidence && ready && !masked && comparison.available && <Evidence section={evidence} shape={shape} guide={guide} average={average} close={() => setEvidence(null)} />}
  </section>;
}
