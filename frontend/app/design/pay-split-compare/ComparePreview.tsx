"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import { SheetFrame } from "@/components/SheetFrame";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { GUIDES, compareShape, guideFor, money, signedMoney, type GuideId } from "@/lib/paySplitReference";
import { EXAMPLES, categoryEvidence, fixture, flowText, type Example } from "./model";
import { Actions, NoFigures, ReferenceChoice, labels, share, type VariantProps } from "./shared";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import VariantC from "./VariantC";
import s from "./preview.module.css";

const OPTIONS = [
  { id: "a", label: "A · Numbers first", description: "Your share and the example in words. No chart to read." },
  { id: "b", label: "B · Paired bars", description: "Two named bars per group. You and the example use the same scale." },
  { id: "c", label: "C · All in one", description: "Income, money spent or moved, and the comparison in one card." },
] as const;
type Variant = typeof OPTIONS[number]["id"];

export default function ComparePreview() {
  const q = useSearchParams();
  const variant: Variant = q.get("variant") === "b" ? "b" : q.get("variant") === "c" ? "c" : "a";
  const example = EXAMPLES.find(item => item.id === q.get("state"))?.id ?? "kevin";
  const mode = q.get("mode") === "light" ? "light" : "dark";
  const hidden = q.get("hidden") === "1", clean = q.get("clean") === "1", average = q.get("average") === "1";
  return <Preview key={[variant, example, mode, hidden, average].join("-")} variant={variant} example={example} mode={mode} hidden={hidden} clean={clean} average={average} initialReference={guideFor(q.get("reference")).id} />;
}

function Preview({ variant, example, mode, hidden, clean, average, initialReference }: {
  variant: Variant; example: Example; mode: "light" | "dark"; hidden: boolean; clean: boolean; average: boolean; initialReference: GuideId;
}) {
  const [reference, setReference] = useState(initialReference);
  const [picker, setPicker] = useState(false), [breakdown, setBreakdown] = useState(false);
  const [saveError, setSaveError] = useState(example === "save-error");
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const guide = guideFor(reference), shape = fixture(example), comparison = compareShape(shape, guide);
  const loading = example === "loading", visible = !hidden && !loading && comparison.available;
  const option = OPTIONS.find(item => item.id === variant)!;
  const href = useCallback((patch: Record<string, string> = {}) => "/design/pay-split-compare?" + new URLSearchParams({ variant, state: example, mode, hidden: hidden ? "1" : "0", reference, ...(clean ? { clean: "1" } : {}), ...(average ? { average: "1" } : {}), ...patch }), [variant, example, mode, hidden, reference, clean, average]);
  useEffect(() => {
    const root = document.documentElement, wasDark = root.classList.contains("dark"), scheme = root.style.colorScheme;
    root.classList.toggle("dark", mode === "dark"); root.style.colorScheme = mode;
    return () => { root.classList.toggle("dark", wasDark); root.style.colorScheme = scheme; };
  }, [mode]);
  useEffect(() => { const path = href(); if (location.pathname + location.search !== path) history.replaceState(history.state, "", path); }, [href]);
  const choose = (id: GuideId) => { setReference(id); setPicker(false); setSaveError(false); };
  const props: VariantProps = { comparison, guide, visible, average, onChoose: () => setPicker(true), onBreakdown: () => setBreakdown(true) };
  const Variant = variant === "a" ? VariantA : variant === "b" ? VariantB : VariantC;

  return <BalancesHiddenContext.Provider value={hidden}><div className={s.preview} data-theme={mode} data-g343-preview data-hydrated={hydrated}>
    <main className={s.main}>
      {!clean && <header className={s.review}>
        <h1>Your pay, made clearer · G343</h1>
        <p>Three new designs with synthetic figures. Open View breakdown in each. Production is unchanged.</p>
        <nav aria-label="Design options">{OPTIONS.map(item => <a key={item.id} href={href({ variant: item.id })} aria-current={variant === item.id ? "page" : undefined}>{item.label}</a>)}</nav>
        <details><summary>Examples &amp; display<ChevronDown size={16} aria-hidden="true" /></summary><div className={s.controls}>
          <label>Example<select value={example} onChange={event => location.assign(href({ state: event.target.value }))}>{EXAMPLES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <a href={href({ mode: mode === "dark" ? "light" : "dark" })}>{mode === "dark" ? "Light theme" : "Dark theme"}</a>
          <a href={href({ hidden: hidden ? "0" : "1" })}>{hidden ? "Show figures" : "Hide figures"}</a>
          <a href={href({ average: average ? "0" : "1" })}>{average ? "Single pay period" : "Average per pay period"}</a>
        </div></details>
      </header>}
      {!clean && <div className={s.direction}><h2>{option.label}</h2><p>{option.description}</p></div>}
      <p className={s.period}>{average ? "Spend · average per pay period" : "Spend · September"}</p>
      {saveError && <p className={s.error} role="alert">Your choice could not be saved. The last choice is still shown.<button type="button" onClick={() => setPicker(true)}>Try again</button></p>}
      <div data-g343-surface>
        {variant !== "c" && <section className={s.overview} aria-label="Pay period summary">
          <h2>How your pay was used</h2>
          {visible ? <>
            <div className={s.totals}><p><span>Income</span><MoneyText text={money(comparison.income)} /></p><p><span>Spent or moved</span><MoneyText text={money(comparison.totalOut)} /></p></div>
            <p className={s.flow}><MoneyText text={flowText(comparison)} /></p>
            <p className={s.summaryNote}>Money moved is part of this total. All shares below use income.</p>
          </> : <NoFigures loading={loading} hidden={hidden} available={comparison.available} />}
        </section>}
        {visible ? <Variant {...props} /> : <section className={s.emptyCard}>
          <header className={s.emptyHeader}><h2>Compare your pay</h2><ReferenceChoice guide={guide} onChoose={() => setPicker(true)} /></header>
          <NoFigures loading={loading} hidden={hidden} available={comparison.available} />
          <Actions {...props} />
        </section>}
      </div>
    </main>
    {picker && <SheetFrame title="Choose an example" description="This changes the comparison only." onClose={() => setPicker(false)} bodyClassName="px-5 py-3">
      <fieldset className={s.choices}><legend className="sr-only">Example to compare with</legend>{GUIDES.map(item => <label key={item.id}>
        <input type="radio" name="g343-example" checked={reference === item.id} onChange={() => choose(item.id)} />
        <span><strong>{item.shortName}</strong><small>{item.shares ? "Half for needs, a fifth for saving or paying debt, and the rest for other spending." : item.ranges ? "Ranges for needs, cash saving, investing and other spending." : "Putting money aside first, with no set shares."}</small></span>
      </label>)}</fieldset>
    </SheetFrame>}
    {breakdown && visible && <SheetFrame title="Your pay split" description={average ? "Average per pay period" : "September · completed pay period"} onClose={() => setBreakdown(false)} bodyClassName="px-5 py-4">
      <div className={s.evidence}>
        <p className={s.inOut}><MoneyText text={"Income " + money(comparison.income) + ". Spent or moved " + money(comparison.totalOut) + "."} /></p>
        <p className={s.sheetFlow}><MoneyText text={flowText(comparison)} /></p>
        <p className={s.sheetNote}>Money moved is part of this total. Each share below is of income.</p>
        {comparison.rows.map(row => {
          const evidence = categoryEvidence(shape, row.id);
          return <details key={row.id} className={s.categoryGroup}>
            <summary><span><strong>{labels[row.id]}</strong><small>About {share(row.incomeShare)} of income</small></span><span className={s.groupTotal}><MoneyText text={money(row.actual)} /><ChevronDown size={16} aria-hidden="true" /></span></summary>
            {evidence.available ? <div className={s.categories}>
              {evidence.rows.map((driver, index) => <p key={String(driver.category) + index}><span>{driver.category ?? "Other amounts"}</span><MoneyText text={driver.amount < 0 ? signedMoney(driver.amount) : money(driver.amount)} /></p>)}
              {evidence.smallAmount !== 0 && <details className={s.rounding}><summary>Small amounts included<ChevronDown size={14} aria-hidden="true" /></summary><p><MoneyText text={(evidence.smallAmount < 0 ? signedMoney(evidence.smallAmount) : money(evidence.smallAmount)) + (evidence.smallAmount < 0 ? " is taken off this total for small rounding or unlabelled moves." : " of small rounding or unlabelled moves is included in this total.")} /></p></details>}
            </div> : <p className={s.sheetNote}>We do not have the category detail for this group. No amounts have been guessed.</p>}
            {row.id === "moved" && <p className={s.sheetNote}>Can include transfers between your accounts. It is not all new saving.</p>}
          </details>;
        })}
        <p className={s.sheetFoot}>Refunds reduce these totals.{average ? " These are averages for the same pay periods." : ""}</p>
      </div>
    </SheetFrame>}
  </div></BalancesHiddenContext.Provider>;
}
