"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { SheetFrame } from "@/components/SheetFrame";
import MoneyText from "@/components/MoneyText";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { compareShape, guideFor, GUIDES, money, signedMoney, referenceAmount, type Comparison, type GuideId, type SectionId } from "@/lib/paySplitReference";
import { DESCRIPTIONS, EXAMPLES, NAMES, compactAmount, fixture, percent, reading, type Example } from "./model";
import s from "@/components/PaySplitComparison.module.css";
import p from "./flow.module.css";

function SavingIdea() {
  return <div className={p.prose}>
    <p>Saving before spending means putting money aside when you get paid, then planning other spending around what remains.</p>
    <p>This budgeting approach is often called “pay yourself first”. You choose the amount to save.</p>
  </div>;
}
function Help({ reference, separate }: { reference: GuideId; separate: boolean }) {
  return <details className={p.help}>
    <summary>{reference === "first" ? "What do these groups mean?" : "How this comparison works"}<ChevronDown size={16} aria-hidden="true" /></summary>
    <div className={p.prose}>
      {reference === "50-30-20" && <><p>The original 50/30/20 idea uses 50% of income for needs, 30% for wants and 20% for savings or paying off debt.</p><p>Sorted uses Fixed, Free and Moved as rough matches. The example is not a judgement about which payments you need.</p><p>A plus means more than the example amount. A minus means less.</p></>}
      {reference === "conscious" && <><p>These examples use 50 to 60% of income for Fixed, 10 to 20% for Moved, and 20 to 35% for Free.</p><p>Each range stands on its own. They do not form a single split that adds up to 100%. An amount inside its range has no difference.</p></>}
      <dl><dt>Fixed</dt><dd>Bills and basics, including groceries and transport.</dd><dt>Moved</dt><dd>Money moved to savings or investing. This can include transfers between your accounts, so it does not measure how much your savings grew.</dd><dt>Free</dt><dd>Other spending recorded in this period. It is not money still available to spend.</dd></dl>
      {reference !== "first" && <p>The comparison uses income. The pay-split bar can use total outgoings when more went out than came in, so its percentages can differ.</p>}
      {separate && <details className={p.learning}><summary>What does saving before spending mean?<ChevronDown size={16} aria-hidden="true" /></summary><SavingIdea /><p>This is a budgeting idea. The comparison shows recorded amounts and cannot tell whether savings were set aside first.</p></details>}
    </div>
  </details>;
}
function PairedBars({ comparison }: { comparison: Comparison }) {
  const scale = Math.max(comparison.income, comparison.totalOut);
  return <div className={s.pairedBars} aria-label="Your amounts and the example on the same pound scale">
    {[{label:"Your amounts", example:false}, {label:"50/30/20 example", example:true}].map(item => <div className={s.barGroup} key={item.label}>
      <span>{item.label}</span><div className={s.stackedBar} aria-hidden="true">
        {comparison.rows.map(row => <i key={row.id} className={s[row.id]} style={{width: `${(item.example ? row.guide ?? 0 : row.actual) / scale * 100}%`}} />)}
        {!item.example && comparison.left > 0 && <i className={s.left} style={{width:`${comparison.left / scale * 100}%`}} />}
        <span className={s.incomeTick} style={{left:`${comparison.income / scale * 100}%`}} />
      </div>
    </div>)}
    <p>The line marks your income. Both bars use the same pound scale.</p>
  </div>;
}
export default function FlowPreview() {
  const q = useSearchParams();
  const variant = q.get("variant") === "b" ? "b" : "a", mode = q.get("mode") === "dark" ? "dark" : "light";
  const example = EXAMPLES.find(item => item === q.get("state")) ?? "kevin";
  return <Flow key={[variant,mode,example,q.get("hidden") === "1",q.get("average") === "1"].join("-")} variant={variant} mode={mode} example={example} hidden={q.get("hidden") === "1"} average={q.get("average") === "1"} clean={q.get("clean") === "1"} initialReference={guideFor(q.get("reference") ?? "first").id} initialView={q.get("view") === "detail" ? "detail" : "card"} />;
}
function Flow({variant,mode,example,hidden,average,clean,initialReference,initialView}: {
  variant:"a"|"b";mode:"light"|"dark";example:Example;hidden:boolean;average:boolean;clean:boolean;initialReference:GuideId;initialView:"card"|"detail";
}) {
  const [reference,setReference] = useState(initialReference), [view,setView] = useState(initialView);
  const [picker,setPicker] = useState(false), [section,setSection] = useState<SectionId|null>(null), [saveError,setSaveError] = useState(example === "save-error");
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const shape = fixture(example), guide = guideFor(reference), comparison = compareShape(shape,guide), loading = example === "loading";
  const visible = !loading && !hidden && comparison.available, idea = reference === "first", legacyIdea = variant === "b" && idea;
  const href = (patch:Record<string,string>={}) => "/design/pay-split-clarity?" + new URLSearchParams({variant,mode,state:example,reference,view,hidden:hidden?"1":"0",average:average?"1":"0",...(clean?{clean:"1"}:{}),...patch});
  const path = href(), previousView = useRef(view), previousLegacy = useRef(legacyIdea);
  useEffect(() => { const root=document.documentElement, dark=root.classList.contains("dark"), scheme=root.style.colorScheme; root.classList.toggle("dark",mode === "dark");root.style.colorScheme=mode;return()=>{root.classList.toggle("dark",dark);root.style.colorScheme=scheme;}; },[mode]);
  useEffect(() => { if(location.pathname+location.search !== path)history.replaceState(history.state,"",path); },[path]);
  useEffect(() => { if(previousView.current !== view || previousLegacy.current !== legacyIdea){previousView.current=view;previousLegacy.current=legacyIdea;document.querySelector<HTMLElement>("[data-view-heading]")?.focus();} },[view,legacyIdea]);
  const choose = (id:GuideId) => {setReference(id);setPicker(false);setSaveError(false);};
  const selected = comparison.rows.find(row => row.id === section);
  const drivers = shape.jobs?.find(job => job.id === section)?.drivers;
  const reconciles = !!selected && !!drivers && drivers.every(driver=>Number.isFinite(driver.amount)) && Math.abs(drivers.reduce((sum,driver)=>sum+driver.amount,0)-selected.actual)<.005;
  return <BalancesHiddenContext.Provider value={hidden}><main className={p.page} data-g346-preview data-hydrated={hydrated}>
    {!clean && <header className={p.review}>
      <h1>A clearer comparison flow · G346</h1>
      <p>A explains every choice in place. B keeps numerical examples together and explains saving before spending separately. Synthetic figures.</p>
      <nav aria-label="Design options"><a href={href({variant:"a"})} aria-current={variant === "a"?"page":undefined}>A · Explain in place</a><a href={href({variant:"b"})} aria-current={variant === "b"?"page":undefined}>B · Compare and learn</a></nav>
      <details><summary>Examples &amp; display<ChevronDown size={16} aria-hidden="true" /></summary><div className={p.controls}>
        <label>Example<select value={example} onChange={event=>location.assign(href({state:event.target.value}))}>{EXAMPLES.map(item=><option key={item}>{item}</option>)}</select></label>
        <a href={href({mode:mode === "light"?"dark":"light"})}>{mode === "light"?"Dark":"Light"} theme</a>
        <a href={href({hidden:hidden?"0":"1"})}>{hidden?"Show":"Hide"} figures</a>
        <a href={href({average:average?"0":"1"})}>{average?"Single period":"Period average"}</a>
        <a href={href({reference:"first",view:"card"})}>Start with saving first</a>
        <a href={href({reference:"50-30-20",view:"card"})}>Start with 50/30/20</a>
      </div></details>
      <p>The separate G344 round covers the range layout. This round covers what each choice means and the steps through the flow.</p>
    </header>}
    {view === "detail" && !legacyIdea && <button type="button" className={p.back} onClick={()=>setView("card")}><ArrowLeft size={17} aria-hidden="true" />Back to Spend</button>}
    <section className={s.comparison} aria-label="Pay comparison" data-g346-card>
        {saveError && <p className={p.error} role="alert">Your choice could not be saved. Your previous choice is still shown.<button type="button" onClick={()=>setPicker(true)}>Try again</button></p>}
      {legacyIdea ? <>
        <h2 data-view-heading tabIndex={-1}>Saving before spending</h2><SavingIdea />
        {loading && <p className={p.note} role="status">Loading your comparison…</p>}
        <p className={p.note}>To compare your amounts, choose an example below.</p>
        <button type="button" className={p.action} onClick={()=>setPicker(true)} disabled={loading}>Choose a comparison<ChevronRight size={16} aria-hidden="true" /></button>
      </> : <>
        <button type="button" className={s.referenceButton} aria-label={"Choose "+(variant === "a"?"a view":"a comparison")+", current: "+NAMES[reference]} aria-haspopup="dialog" disabled={loading} onClick={()=>setPicker(true)}><span><small>{variant === "a"?"Explore your pay":"Compare with"}</small><strong>{loading?"Loading your comparison…":NAMES[reference]}</strong></span><ChevronRight size={16} aria-hidden="true" /></button>
        {idea && <SavingIdea />}
        {!visible ? <p className={p.note} role={loading?"status":undefined}>{loading?"Loading your amounts…":hidden?"Your figures are hidden.":"We need a completed pay period with income to show your amounts."}</p> : <>
          <h2 className={idea?p.subheading:undefined} data-view-heading tabIndex={-1}>{view === "detail"?idea?"Your recorded amounts":"Your amounts and the example":guide.shares?"Difference from the example":average?"Your average amounts":"Your amounts this period"}</h2>
          <p className={s.baseNote}><MoneyText text={(average?"Average income per pay period: ":"Income for this pay period: ")+money(comparison.income)+"."} /></p>
          {view === "card" ? <div className={[s.compactRows,p.compact,comparison.rows.some(row=>compactAmount(row).length>10)?s.compactLong:""].join(" ")}>{comparison.rows.map(row=><button type="button" key={row.id} aria-label={"View "+row.label+" breakdown. "+(guide.shares?"Difference ":"Your amount ")+compactAmount(row)+(idea?"":". "+reading(row))} onClick={()=>setSection(row.id)}><span>{row.label}</span><MoneyText text={compactAmount(row)} />{!idea && <small>{reading(row)}</small>}</button>)}</div> : <>
            {guide.shares && <PairedBars comparison={comparison} />}
            <div className={s.rows}>{comparison.rows.map(row=><div className={s.row} key={row.id}>
              <button type="button" aria-label={"View "+row.label+" breakdown"} onClick={()=>setSection(row.id)}><span className={s.rowTitle}><i className={s[row.id]} aria-hidden="true" /><strong>{row.label}</strong></span><ChevronRight size={16} aria-hidden="true" /></button>
              {idea?<div className={s.principleRow}><span>Your amount</span><MoneyText text={money(row.actual)} /></div>:<><div className={[s.amounts,[money(row.actual),referenceAmount(row),signedMoney(row.delta??0)].some(value=>value.length>10)?s.longAmounts:""].join(" ")}><span><small>Your amount</small><MoneyText text={money(row.actual)} /></span><span><small>{percent(row)} example{guide.ranges?" range":""}</small><span className={s.referenceRange}><MoneyText text={referenceAmount(row)} /></span></span><span><small>Difference</small><MoneyText text={signedMoney(row.delta??0)} /></span></div><p className={s.rowReading}>{reading(row)}</p></>}
            </div>)}</div>
          </>}
          {idea && <p className={p.note}>Moved can include transfers between your accounts. These amounts cannot tell whether savings were set aside first.</p>}
          {view === "card" && <button type="button" className={s.viewComparison} onClick={()=>setView("detail")}>See full breakdown<ChevronRight size={16} aria-hidden="true" /></button>}
          {view === "detail" && comparison.beyond>0 && <div className={p.cashflow}><strong>More went out than came in</strong><MoneyText text={money(comparison.beyond)} /><p>This compares all money spent or moved with income.{guide.ranges?" It is separate from the differences against each example range.":""}</p></div>}
        </>}
        <Help reference={reference} separate={variant === "b"} />
      </>}
    </section>
    {picker && <SheetFrame title={variant === "a"?"Choose a way to look at your pay":"Choose a comparison"} description={"This choice only changes "+(variant === "a"?"this view":"the comparison")+". It will not create a budget or move money."} onClose={()=>setPicker(false)} bodyClassName="px-5 py-3">{({closeThen}) => <>
      <fieldset className={s.guideList}><legend className="sr-only">{variant === "a"?"View":"Comparison"} choice</legend>{GUIDES.filter(item=>variant === "a"||item.id !== "first").map(item=><label className={s.guideRow} key={item.id}><input type="radio" name="g346-choice" checked={reference === item.id} onChange={()=>closeThen(()=>choose(item.id))} /><span><strong>{NAMES[item.id]}</strong><small>{DESCRIPTIONS[item.id]}</small></span></label>)}</fieldset>
      {variant === "b" && <details className={p.learning}><summary>What does saving before spending mean?<ChevronDown size={16} aria-hidden="true" /></summary><SavingIdea /><p className={p.note}>It is an idea to learn about, so it does not change your comparison.</p></details>}
    </>}</SheetFrame>}
    {selected && visible && <SheetFrame title={selected.label+" breakdown"} description={(average?"Average per pay period · ":"")+(shape.period?.label??"Selected pay period")} onClose={()=>setSection(null)} bodyClassName="px-5 py-4">
      {reconciles ? drivers.length ? <div className={s.evidence}>{drivers.map((driver,index)=><div key={index}><span>{driver.category??"Other amounts and rounding"}</span><MoneyText text={driver.amount<0?signedMoney(driver.amount):money(driver.amount)} /></div>)}</div>:<p className={p.note}>No recorded payments in this group.</p>:<p className={p.note}>The category breakdown is not available for this period.</p>}
      <div className={s.evidenceTotal}><strong>{selected.label} total</strong><MoneyText text={money(selected.actual)} /></div>
      {section === "moved" && <p className={p.note}>Moved can include transfers between your accounts. It does not measure how much your savings grew.</p>}
      <p className={p.note}>Refunds are taken off spending.{average?" These amounts are averages across the same completed pay periods.":" These amounts cover the selected pay period."}</p>
    </SheetFrame>}
  </main></BalancesHiddenContext.Provider>;
}
