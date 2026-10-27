"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SheetFrame } from "@/components/SheetFrame";
import MoneyText from "@/components/MoneyText";
import PaySplitComparison from "@/components/PaySplitComparison";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { compareShape, guideFor, GUIDES, money, referenceAmount, signedMoney, type Comparison, type ComparisonRow, type GuideId } from "@/lib/paySplitReference";
import { EXAMPLES, evidence, fixture, guidePercent, status, summary, type Example } from "./model";
import s from "./ranges.module.css";

export default function RangePreview() {
  const q = useSearchParams(), variant = q.get("variant") === "b" ? "b" : "a", mode = q.get("mode") === "light" ? "light" : "dark", hidden = q.get("hidden") === "1", clean = q.get("clean") === "1";
  const example = EXAMPLES.find(item => item.id === q.get("state"))?.id ?? "kevin";
  return <Preview key={[variant, mode, hidden, example].join("-")} variant={variant} mode={mode} hidden={hidden} clean={clean} example={example} initialReference={guideFor(q.get("reference") ?? "conscious").id} />;
}
function Preview({ variant, mode, hidden, clean, example, initialReference }: {
  variant: "a" | "b"; mode: "light" | "dark"; hidden: boolean; clean: boolean; example: Example; initialReference: GuideId;
}) {
  const [reference, setReference] = useState(initialReference);
  const [picker, setPicker] = useState(false), [selected, setSelected] = useState<ComparisonRow | null>(null);
  const [saveError, setSaveError] = useState(example === "save-error");
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const shape = fixture(example), guide = guideFor(reference), comparison = compareShape(shape, guide);
  const loading = example === "loading", visible = !loading && !hidden && comparison.available;
  const href = useCallback((patch: Record<string, string> = {}) => "/design/pay-split-ranges?" + new URLSearchParams({ variant, mode, state: example, hidden: hidden ? "1" : "0", reference, ...(clean ? { clean: "1" } : {}), ...patch }), [variant, mode, example, hidden, reference, clean]);
  useEffect(() => {
    const root = document.documentElement, dark = root.classList.contains("dark"), scheme = root.style.colorScheme;
    root.classList.toggle("dark", mode === "dark"); root.style.colorScheme = mode;
    return () => { root.classList.toggle("dark", dark); root.style.colorScheme = scheme; };
  }, [mode]);
  useEffect(() => { const path = href(); if (location.pathname + location.search !== path) history.replaceState(history.state, "", path); }, [href]);
  const choose = (id: GuideId) => { setReference(id); setPicker(false); setSaveError(false); };
  return <BalancesHiddenContext.Provider value={hidden}><div className={s.preview} data-g344-preview data-hydrated={hydrated} data-theme={mode}>
    <main className={s.main}>
      {!clean && <header className={s.review}>
        <h1>A quieter range comparison · G344</h1>
        <p>Two focused changes to the four-part range view. Synthetic figures; production is unchanged.</p>
        <nav aria-label="Design options">{[["a", "A · Compact rows"], ["b", "B · Small table"]].map(([id, label]) => <a key={id} href={href({ variant: id })} aria-current={variant === id ? "page" : undefined}>{label}</a>)}</nav>
        <details><summary>Examples &amp; display<ChevronDown size={16} aria-hidden="true" /></summary><div className={s.controls}>
          <label>Example<select value={example} onChange={event => location.assign(href({ state: event.target.value }))}>{EXAMPLES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <a href={href({ mode: mode === "dark" ? "light" : "dark" })}>{mode === "dark" ? "Light theme" : "Dark theme"}</a>
          <a href={href({ hidden: hidden ? "0" : "1" })}>{hidden ? "Show figures" : "Hide figures"}</a>
        </div></details>
        <p className={s.direction}>{variant === "a" ? "One amount, one percentage guide and one short status per group." : "One overall summary. Compare your amounts with the percentage guides in a small table."} Tap a group for the exact numbers.</p>
      </header>}
      {saveError && <div className={s.error} role="alert">Your choice could not be saved. Your last choice is still shown.<button type="button" onClick={() => setPicker(true)}>Try again</button></div>}
      <div data-g344-card>
        {!guide.ranges && !loading ? <PaySplitComparison shape={shape} view="detail" reference={reference} onReferenceChange={choose} hideValues={hidden} /> : <section className={s.card} aria-label={guide.shortName + " comparison"}>
          <button type="button" className={s.reference} aria-label={"Choose a reference, current: " + guide.name} aria-haspopup="dialog" onClick={() => setPicker(true)}><span><small>Compare with</small><strong>{guide.name}</strong></span><ChevronRight size={16} aria-hidden="true" /></button>
          {visible ? <>
            <p className={s.basis}><MoneyText text={"Based on your " + money(comparison.income) + " income."} /></p>
            {variant === "a" ? <ul className={s.rows}>{comparison.rows.map(row => <li key={row.id}>
              <button type="button" className={s.rowButton} aria-label={"View " + row.label + " comparison. Your amount " + money(row.actual) + ". Guide " + guidePercent(row) + ". " + status(row) + "."} onClick={() => setSelected(row)}>
                <span className={s.rowHead}><span className={s.group}><i className={s[row.id]} aria-hidden="true" /><strong>{row.label}</strong></span><span className={s.value}><MoneyText text={money(row.actual)} /><ChevronRight size={15} aria-hidden="true" /></span></span>
                <span className={s.rowSub}><span>Guide {guidePercent(row)}</span><MoneyText className={s.status} text={status(row)} /></span>
              </button>
            </li>)}</ul> : <CompactTable comparison={comparison} select={setSelected} />}
          </> : <p className={s.empty} role={loading ? "status" : undefined}>{loading ? "Loading your comparison…" : hidden ? "Your figures are hidden." : "We need a full pay period with income to show this comparison."}</p>}
          {guide.ranges && <details className={s.help}><summary>How this works<ChevronDown size={14} aria-hidden="true" /></summary>
            <p>These ranges are examples, not spending limits. Each range stands on its own. They do not need to add up to 100%.</p>
            <p>The comparison uses income. An amount inside its range has no difference. Outside the range, the difference is measured from the closest edge.</p>
            <p>The four parts are bills and basics, cash saving, investing, and other spending. Saving and investing are compared with Moved here.</p>
            <p>Fixed includes bills, groceries, transport and loan payments. Moved can include transfers between your accounts, so it is not a measure of new saving.</p>
          </details>}
          <p className={s.disclaimer}>No budget or target is set.</p>
        </section>}
      </div>
    </main>
    {picker && <SheetFrame title="Choose a reference" description="This changes only the comparison." onClose={() => setPicker(false)} bodyClassName="px-5 py-3">
      <fieldset className={s.choices}><legend className="sr-only">Reference choice</legend>{GUIDES.map(item => <label key={item.id}>
        <input type="radio" name="g344-reference" checked={reference === item.id} onChange={() => choose(item.id)} />
        <span><strong>{item.name}</strong><small>{item.id === "conscious" ? "Independent ranges for Fixed, Moved and Free." : item.id === "50-30-20" ? "A 50%, 30%, 20% example, roughly matched to Sorted’s groups." : "A principle about setting money aside, with no set percentages."}</small></span>
      </label>)}</fieldset>
    </SheetFrame>}
    {selected && visible && <SheetFrame title={selected.label + " comparison"} description="September · completed pay period" onClose={() => setSelected(null)} bodyClassName="px-5 py-4">
      <div className={s.working}>
        <dl><div><dt>Your amount</dt><dd><MoneyText text={money(selected.actual)} /></dd></div><div><dt>Guide {guidePercent(selected)}</dt><dd><MoneyText text={referenceAmount(selected)} /></dd></div></dl>
        <p className={s.sheetStatus}><MoneyText text={status(selected)} /></p>
        <p className={s.sheetNote}><MoneyText text={"The guide uses your " + money(comparison.income) + " income. Each range stands on its own."} /></p>
        <details className={s.categories}><summary>What is in this amount<ChevronDown size={14} aria-hidden="true" /></summary>
          {evidence(shape, selected) === null ? <p className={s.sheetNote}>The category detail is not available. No amounts have been guessed.</p> : evidence(shape, selected)!.length === 0 ? <p className={s.sheetNote}>No payments in this group.</p> : evidence(shape, selected)!.map((item, index) => <p key={index}><span>{item.category ?? "Other amounts and rounding"}</span><MoneyText text={item.amount < 0 ? signedMoney(item.amount) : money(item.amount)} /></p>)}
        </details>
        {selected.id === "moved" && <p className={s.sheetNote}>Moved can include transfers between your accounts. It does not show how much your total savings grew.</p>}
      </div>
    </SheetFrame>}
  </div></BalancesHiddenContext.Provider>;
}
function CompactTable({ comparison, select }: { comparison: Comparison; select: (row: ComparisonRow) => void }) {
  return <div className={s.tableArea} role="region" aria-label="Range comparison table" tabIndex={0}>
    <p className={s.summary}>{summary(comparison)}</p>
    <table className={s.table}><caption className="sr-only">Your amounts and example ranges based on income</caption>
      <thead><tr><th scope="col">Group</th><th scope="col">Your amount</th><th scope="col">Guide</th></tr></thead>
      <tbody>{comparison.rows.map(row => <tr key={row.id}>
        <th scope="row"><button type="button" onClick={() => select(row)} aria-label={"View " + row.label + " comparison"}><i className={s[row.id]} aria-hidden="true" />{row.label}<ChevronRight size={13} aria-hidden="true" /></button></th>
        <td><MoneyText text={money(row.actual)} />{row.delta !== 0 && <small><MoneyText text={status(row)} /></small>}</td>
        <td>{guidePercent(row)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
