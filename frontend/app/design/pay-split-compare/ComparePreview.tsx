"use client";
import {useCallback,useEffect,useState} from "react";
import {useSearchParams} from "next/navigation";
import {SheetFrame} from "@/components/SheetFrame";
import MoneyText from "@/components/MoneyText";
import {BalancesHiddenContext} from "@/lib/balancesHidden";
import {GUIDES,compareShape,guideFor,money,type GuideId} from "@/lib/paySplitReference";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import VariantC from "./VariantC";
import {EXAMPLES,fixture,type Example} from "./fixtures";
import {guideName,type VariantProps} from "./shared";
import s from "./preview.module.css";
const OPTIONS=[{id:"a",name:"A · Clear rows",description:"A simple reading: group, difference, short explanation."},{id:"b",name:"B · Share tracks",description:"See your share against a point or range for each group."},{id:"c",name:"C · Split overview",description:"Read the overall split first, then the differences."}] as const;
export default function ComparePreview(){const q=useSearchParams();const variant=q.get("variant")==="b"?"b":q.get("variant")==="c"?"c":"a",example=EXAMPLES.find(e=>e.id===q.get("state"))?.id??"kevin",mode=q.get("mode")==="light"?"light":"dark",hidden=q.get("hidden")==="1",initialReference=guideFor(q.get("reference")).id,clean=q.get("clean")==="1";return <Preview key={`${variant}-${example}-${mode}-${hidden}`} variant={variant} example={example} mode={mode} hidden={hidden} initialReference={initialReference} clean={clean}/>;}
function Preview({variant,example,mode,hidden,initialReference,clean}:{variant:"a"|"b"|"c";example:Example;mode:"light"|"dark";hidden:boolean;initialReference:GuideId;clean:boolean}){
 const[reference,setReference]=useState(initialReference),[referenceOpen,setReferenceOpen]=useState(false),[breakdown,setBreakdown]=useState(false),[saveError,setSaveError]=useState(example==="save-error");
 const guide=guideFor(reference),shape=fixture(example),comparison=compareShape(shape,guide),loading=example==="loading",option=OPTIONS.find(o=>o.id===variant)!;
 const href=useCallback((patch:Record<string,string>={})=>"/design/pay-split-compare?"+new URLSearchParams({variant,state:example,mode,hidden:hidden?"1":"0",reference,...(clean?{clean:"1"}:{}),...patch}),[variant,example,mode,hidden,reference,clean]);
 useEffect(()=>{const root=document.documentElement,previousDark=root.classList.contains("dark"),previousScheme=root.style.colorScheme;root.classList.toggle("dark",mode==="dark");root.style.colorScheme=mode==="dark"?"dark":"light";return()=>{root.classList.toggle("dark",previousDark);root.style.colorScheme=previousScheme;};},[mode]);
 useEffect(()=>{const path=href();if(location.pathname+location.search!==path)history.replaceState(history.state,"",path);},[href]); // The choice is local to this synthetic preview.
 const choose=(id:GuideId)=>{setReference(id);setReferenceOpen(false);setSaveError(false);};
 const props:VariantProps={comparison,guide,hidden,loading,onReferenceChange:choose,onOpenReference:()=>setReferenceOpen(true),onBreakdown:()=>setBreakdown(true)};
 const Variant=variant==="a"?VariantA:variant==="b"?VariantB:VariantC;
 return <BalancesHiddenContext.Provider value={hidden}><div className={s.preview} data-theme={mode} data-g342-variant={variant}><main className={s.main}>
 {!clean&&<header className={s.review}><h1>Compare with · G342</h1><p>Three designs using synthetic figures. Production is unchanged.</p><nav aria-label="Design options">{OPTIONS.map(o=><a key={o.id} href={href({variant:o.id})} aria-current={variant===o.id?"page":undefined}>{o.name}</a>)}</nav><details><summary>Examples &amp; display</summary><div className={s.controls}><label>Example<select value={example} onChange={e=>location.assign(href({state:e.target.value}))}>{EXAMPLES.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label><a href={href({mode:mode==="dark"?"light":"dark"})}>{mode==="dark"?"Light theme":"Dark theme"}</a><a href={href({hidden:hidden?"0":"1"})}>{hidden?"Show figures":"Hide figures"}</a></div></details></header>}
 {!clean&&<div className={s.direction}><h2>{option.name}</h2><p>{option.description}</p></div>}
 <div className={s.productContext}>Spend · September</div>
 {saveError&&<div className={s.error} role="alert">Your reference could not be changed. Your previous choice is still shown.<button type="button" onClick={()=>setReferenceOpen(true)}>Try again</button></div>}
 <div data-g342-card><Variant {...props}/></div>
 </main>
 {referenceOpen&&<SheetFrame title="Choose a comparison" onClose={()=>setReferenceOpen(false)} themeClass={mode==="dark"?"dark":undefined} bodyClassName="px-5 py-3"><fieldset className={s.choices}><legend className={s.srOnly}>Comparison reference</legend>{GUIDES.map(g=><label key={g.id}><input type="radio" name="g342-reference" checked={reference===g.id} onChange={()=>choose(g.id)}/><span><strong>{guideName(g)}</strong><small>{g.id==="50-30-20"?"A 50%, 30%, 20% comparison, roughly matched to Fixed, Free and Moved.":g.id==="conscious"?"Fixed, saving, investing and Free, compared using independent ranges.":"A principle about setting money aside, with no set percentages."}</small></span></label>)}</fieldset></SheetFrame>}
 {breakdown&&!hidden&&!loading&&comparison.available&&<SheetFrame title="Your pay split" description="September · completed pay period" onClose={()=>setBreakdown(false)} themeClass={mode==="dark"?"dark":undefined} bodyClassName="px-5 py-4"><div className={s.evidence}><p>Recorded amounts this pay period, grouped in the same way as your comparison.</p>{comparison.rows.map(row=><details key={row.id}><summary><strong>{row.label}</strong><span><MoneyText text={money(row.actual)}/></span></summary><div>{shape.jobs?.find(j=>j.id===row.id)?.drivers?.map(d=><p key={d.category}><span>{d.category}</span><MoneyText text={money(d.amount)}/></p>)}</div></details>)}<p className={s.total}><span>Income</span><MoneyText text={money(comparison.income)}/></p><p className={s.total}><span>{comparison.beyond>0?"Outgoings minus income":"Income left over"}</span><MoneyText text={money(comparison.beyond||comparison.left)}/></p><p>Reference differences are comparisons, not a claim about which payment caused or funded a gap.</p></div></SheetFrame>}
 </div></BalancesHiddenContext.Provider>;
}
