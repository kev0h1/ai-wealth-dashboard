"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { MoneyShape } from "@/lib/api";
import { GUIDES, compareShape, guideFor, money, signedMoney, referenceAmount, type ComparisonRow, type Guide, type GuideId, type SectionId } from "@/lib/paySplitReference";
import { usePreferences } from "@/components/PreferencesContext";
import MoneyText from "@/components/MoneyText";
import { SheetFrame } from "@/components/SheetFrame";
import s from "./PaySplitComparison.module.css";

type Compared = ReturnType<typeof compareShape>;
const percent = (value: number) => "About " + new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value) + "%";

// A shared axis extends beyond 100% rather than clipping spending above income.
function scaleFor(comparison: Compared) {
  const highest = Math.max(100, ...comparison.rows.map(row => row.incomeShare), ...comparison.rows.map(row => row.guideShareMax ?? 0));
  return Math.ceil(highest / 25) * 25;
}

function ShareTrack({ row, guide, scale, average }: { row: ComparisonRow; guide: Guide; scale: number; average: boolean }) {
  const actual = row.incomeShare / scale * 100;
  const start = (row.guideShareMin ?? 0) / scale * 100;
  const end = (row.guideShareMax ?? 0) / scale * 100;
  const value = row.delta === null ? money(row.actual) : row.delta === 0 ? guide.ranges ? "Within range" : "Matches" : signedMoney(row.delta);
  const reference = guide.ranges ? `${row.guideShareMin} to ${row.guideShareMax}% range` : `${row.guideShare}% reference`;
  const caption = row.delta === null ? average ? "Average per pay period" : "Recorded this pay period" : `${row.delta === 0 ? "" : row.delta > 0 ? "above the " : "below the "}${reference}`;
  return <article className={s.trackRow}>
    <div className={s.rowHeading}>
      <h3 className={s.name}><i className={s[row.id]} aria-hidden="true" />{row.label}</h3>
      <MoneyText className={s.difference} text={value} />
    </div>
    <div className={s.track} aria-hidden="true">
      <span className={s.baseline} />
      {guide.ranges && <span className={s.band} style={{ left: `${start}%`, width: `${end - start}%` }} />}
      {guide.shares && <span className={s.point} style={{ left: `${start}%` }} />}
      <span className={`${s.fill} ${s[row.id]}`} style={{ width: `${actual}%` }} />
      <span className={`${s.marker} ${s[row.id]}`} style={{ left: `${actual}%` }} />
    </div>
    <div className={s.reading}><p>{percent(row.incomeShare)} of income</p><p>{caption}</p></div>
  </article>;
}

function HowItWorks({ guide }: { guide: Guide }) {
  return <details className={s.details}>
    <summary>How it works<ChevronDown size={14} aria-hidden="true" /></summary>
    <p>Fixed, Moved and Free describe your transactions. They only roughly match other ways of grouping income. Moved can include transfers between your own accounts.</p>
    <p>{guide.ranges ? "The four-part example uses independent ranges: Fixed 50 to 60%, cash saving 5 to 10%, investing 5 to 10%, and Free 20 to 35%. Saving and investing are grouped as Moved, 10 to 20%. The ranges do not form one exact split. A difference is measured from the nearest edge of each range." : guide.shares ? "50/30/20 divides income into needs, wants and savings or debt payments. Here, those shares are compared with Fixed, Free and Moved. This is an approximate comparison, not an assessment of what you need." : "Pay yourself first is a principle about setting money aside. It has no set percentages, so there is no numerical reference to match."}</p>
    <p>A comparison difference does not tell us which payment caused or funded a gap. This is general information, not advice.</p>
    {guide.shares && <a href="https://files.consumerfinance.gov/f/201603_cfpb_rules-to-live-by_my-spending-rule-to-live-by.pdf" target="_blank" rel="noopener noreferrer">CFPB spending rule worksheet</a>}
  </details>;
}

function SectionEvidence({ section, shape, guide }: { section: SectionId; shape: MoneyShape; guide: Guide }) {
  const row = compareShape(shape, guide).rows.find(item => item.id === section);
  const drivers = shape.jobs?.find(job => job.id === section)?.drivers;
  const reconciles = !!row && !!drivers && drivers.every(driver => Number.isFinite(driver.amount)) && Math.abs(drivers.reduce((sum, driver) => sum + driver.amount, 0) - row.actual) < .005;
  return <>
    {reconciles ? <div className={s.evidence}>
      {drivers.map((driver, index) => <div key={String(driver.category) + index}><span>{driver.category ?? (section === "moved" ? "Other movements and rounding" : "Rounding difference")}</span><MoneyText text={driver.amount < 0 ? signedMoney(driver.amount) : money(driver.amount)} /></div>)}
    </div> : <p className={s.sheetNote}>The category breakdown is not available for this selection yet. No payments have been estimated.</p>}
    {row && <>
      <div className={s.evidenceTotal}><strong>{row.label} total</strong><MoneyText text={money(row.actual)} /></div>
      {row.delta !== null && <div className={s.evidenceWorking}>
        <p><span>This reference</span><span className={s.referenceRange}><MoneyText text={referenceAmount(row)} /></span></p>
        <p><span>Difference</span><MoneyText text={signedMoney(row.delta ?? 0)} /></p>
      </div>}
    </>}
  </>;
}

function Breakdown({ shape, guide, comparison, average, close }: { shape: MoneyShape; guide: Guide; comparison: Compared; average: boolean; close: () => void }) {
  const params = new URLSearchParams();
  if (shape.period?.start) params.set("from", shape.period.start);
  if (shape.period?.end) params.set("to", shape.period.end);
  return <SheetFrame title="Your pay split" description={(average ? "Average per pay period · " : "") + (shape.period?.label ?? "Selected pay period")} onClose={close} bodyClassName="px-5 py-4" footer={shape.period?.start && shape.period?.end ? <Link href={"/transactions?" + params} className={s.transactions}>Browse transactions in this date range <ChevronRight size={16} aria-hidden="true" /></Link> : undefined}>
    <div className={s.breakdown}>
      <p className={s.sheetNote}>{average ? "Average recorded amounts across the selected completed pay periods." : "Recorded amounts this pay period, grouped in the same way as your comparison."}</p>
      {comparison.rows.map(row => <details className={s.sectionEvidence} key={row.id}>
        <summary><strong>{row.label}</strong><ChevronDown size={16} aria-hidden="true" /></summary>
        <SectionEvidence section={row.id} shape={shape} guide={guide} />
      </details>)}
      <div className={s.evidenceTotal}><strong>Income</strong><MoneyText text={money(comparison.income)} /></div>
      <div className={s.evidenceTotal}><strong>{comparison.beyond > 0 ? "Outgoings minus income" : "Income left over"}</strong><MoneyText text={money(comparison.beyond || comparison.left)} /></div>
      <p className={s.sheetNote}>{guide.ranges ? "Outgoings minus income is calculated separately. Independent range differences do not add up to that amount. " : guide.shares ? "The net reference difference equals outgoings minus income. " : "There is no numeric reference for this principle. "}Reference differences are not a claim about which payment caused or funded a gap.</p>
      <p className={s.sheetNote}>{average ? "Category amounts are means across the same completed pay periods as the comparison, not totals for the whole date range. " : "Category amounts use the same completed pay period as the comparison. "}Spending is net of refunds. The transaction list includes all activity in the date range, not just one section.</p>
    </div>
  </SheetFrame>;
}

export default function PaySplitComparison({ shape, average = false, reference, onReferenceChange, hideValues }: {
  shape: MoneyShape;
  average?: boolean;
  /** Controlled props keep fixture renders inert. Production uses the shared authenticated preference. */
  reference?: GuideId;
  onReferenceChange?: (id: GuideId) => void;
  hideValues?: boolean;
}) {
  const prefs = usePreferences();
  const [picker, setPicker] = useState(false);
  const [breakdown, setBreakdown] = useState(false);
  const controlled = reference !== undefined;
  const ready = controlled || (prefs.preferencesReady && prefs.rawPrefs !== null);
  const masked = hideValues ?? (prefs.hideNetWorth || !prefs.preferencesReady);
  const guide = guideFor(controlled ? reference : prefs.paySplitReference);
  const comparison = compareShape(shape, guide);
  const visible = ready && !masked && comparison.available;
  const error = !controlled && prefs.preferencesSaveError?.field === "pay_split_reference" ? prefs.preferencesSaveError.message : null;
  const choose = (id: GuideId) => {
    if (controlled) onReferenceChange?.(id); else prefs.setPaySplitReference(id);
    setPicker(false);
  };
  return <section className={s.comparison} aria-label="Reference comparison">
    <header className={s.header}>
      <h2>Your income share</h2>
      <button type="button" aria-label={ready ? "Choose a reference, current: " + guide.shortName : "Saved reference not loaded"} aria-haspopup="dialog" disabled={!ready} className={s.referenceButton} onClick={() => setPicker(true)}>
        {ready ? guide.shortName : prefs.preferencesReady ? "Saved reference unavailable" : "Loading saved reference…"}<ChevronDown size={15} aria-hidden="true" />
      </button>
    </header>
    {error && <p className={s.saveError} role="status">{error} Choose the reference again to retry.</p>}
    {!ready ? <div className={s.unavailable}><p>{prefs.preferencesReady ? "Could not load your saved reference." : "Checking your saved reference."}</p>{prefs.preferencesReady && <button type="button" className={s.retry} onClick={() => { void prefs.refreshPreferences().catch(() => {}); }}>Try again</button>}</div> : masked ? <p className={s.baseNote}>Comparison amounts are hidden while Hide balances is on.</p> : !comparison.available ? <div className={s.unavailable}><h3>No comparison yet</h3><p>A completed pay period with income and a complete split is needed. Nothing has been treated as zero.</p></div> : <>
      <p className={s.baseNote}><MoneyText text={average ? `Compared with your ${money(comparison.income)} average income per pay period.` : `Compared with your ${money(comparison.income)} income this period.`} /></p>
      <p className={s.legend}>{guide.ranges ? "Pale bands are independent reference ranges." : guide.shares ? "Pale ticks mark the reference share." : "These tracks show your recorded income shares."} Same 0 to {scaleFor(comparison)}% scale.</p>
      <div className={s.tracks}>{comparison.rows.map(row => <ShareTrack key={row.id} row={row} guide={guide} scale={scaleFor(comparison)} average={average} />)}</div>
    </>}
    <footer className={s.footer}>
      <button type="button" className={s.viewComparison} disabled={!visible} onClick={() => setBreakdown(true)}>View breakdown<ChevronRight size={16} aria-hidden="true" /></button>
      <HowItWorks guide={guide} />
      <p className={s.disclaimer}>No budget or target is set.</p>
    </footer>
    {picker && <SheetFrame title="Choose a reference" description="50/30/20 is the default. Choosing an alternative changes only this comparison, not a budget or bank payment." onClose={() => setPicker(false)} bodyClassName="px-5 py-3"><fieldset className={s.guideList}><legend className="sr-only">Reference choice</legend>{GUIDES.map(item => <label className={s.guideRow} key={item.id}><input type="radio" name="pay-split-reference" checked={item.id === guide.id} onChange={() => choose(item.id)} /><span><strong>{item.shortName}</strong><small>{item.description}</small></span></label>)}</fieldset></SheetFrame>}
    {breakdown && visible && <Breakdown shape={shape} guide={guide} comparison={comparison} average={average} close={() => setBreakdown(false)} />}
  </section>;
}
