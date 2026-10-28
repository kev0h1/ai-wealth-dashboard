"use client";
// Synthetic responses around the production components. Temporary QA route only.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Account, type Commitment, type GoalSchedule, type GoalSchedulePreview, type PennyProposal } from "@/lib/api";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { ProposalConfirmCard, type ProposalMsg } from "@/components/PennyConversation";
import CommitmentSheet from "@/components/CommitmentSheet";
import fixture from "./g351-schedule.json";
const initial = fixture as GoalSchedulePreview;
const accounts = [
 {id:"current",name:"Monzo current account",provider:"Monzo",balance:1600,type:"bank",subtype:"CURRENT_ACCOUNT",currency:"GBP",status:"active",manual:false},
 {id:"other",name:"Joint current account",provider:"Barclays",balance:500,type:"bank",subtype:"CURRENT_ACCOUNT",currency:"GBP",status:"active",manual:false},
 {id:"pot",name:"Saving Challenge pot",provider:"Monzo",balance:0,type:"bank",subtype:"SAVINGS_ACCOUNT",currency:"GBP",status:"active",manual:false},
] as Account[];
const proposal:PennyProposal={proposal_id:"initial",kind:"create_commitment",entity:"4p challenge",summary:"Start the 4p challenge",consequence:"Create a goal",params:{name:"4p challenge",schedule:initial.schedule,schedule_preview:initial,source_account_id:"current",source_account_name:"Monzo current account",destination_names:["Saving Challenge pot"],funding_pots:[{account_id:"pot"}]}};
const initialRecord={id:"goal",name:"4p challenge",amount:2671.8,target_date:"2026-12-31",source_account_id:"current",source:"manual",status:"active",progress:0,remaining:2671.8,periods_left:3,per_period_slice:358.36,planned_per_period_slice:358.36,usual_slice:358.36,on_track:false,shared_pot_goals:[],funding_pots:[{account_id:"pot",name:"Saving Challenge pot",kind:"connected",count_existing:false,contributing_balance:0}],funding_account_id:"pot",funding_account_name:"Saving Challenge pot",schedule:initial.schedule,schedule_preview:initial} as Commitment;
const sleep=(n:number)=>new Promise(r=>setTimeout(r,n));
async function previewSchedule(schedule:GoalSchedule):Promise<GoalSchedulePreview>{
 const multiplier=schedule.type==="arithmetic"?schedule.start_pence/4:1;
 await sleep(multiplier===3?900:80);
 return {...initial,schedule,total:initial.total*multiplier,planned_to_date:initial.planned_to_date*multiplier,label:multiplier===1?initial.label:`Start at ${4*multiplier}p, then add ${4*multiplier}p each day.`,current_period:{...initial.current_period,amount:initial.current_period.amount*multiplier},periods:initial.periods.map(p=>({...p,amount:p.amount*multiplier}))};
}
export default function ScheduledGoalFixture(){
 const [hidden,setHidden]=useState(false),[msg,setMsg]=useState<ProposalMsg>({id:1,role:"assistant",kind:"proposal",status:"pending",proposal});
 const [showPlan,setShowPlan]=useState(false),[record,setRecord]=useState(initialRecord),[fail,setFail]=useState(false),[refreshFail,setRefreshFail]=useState(false),[writes,setWrites]=useState(0);
 useEffect(()=>{const originalAccounts=api.accounts,originalPreview=api.previewGoalSchedule;api.accounts=async()=>accounts;api.previewGoalSchedule=previewSchedule;document.documentElement.dataset.g351Ready="true";return()=>{api.accounts=originalAccounts;api.previewGoalSchedule=originalPreview;delete document.documentElement.dataset.g351Ready;};},[]);
 const refreshFailure=useRef(false);refreshFailure.current=refreshFail;
 const operations=useMemo(()=>({...api,accounts:async()=>accounts,previewGoalSchedule:previewSchedule,updateCommitment:async(_id:string,body:Parameters<typeof api.updateCommitment>[1])=>{await sleep(120);if(fail)throw Error("Synthetic save failure");const next={...record,...body,...(body.schedule?{schedule_preview:await previewSchedule(body.schedule)}:{})} as Commitment;setWrites(v=>v+1);setRecord(next);return next;}}),[record,fail]);
 return <BalancesHiddenContext.Provider value={hidden}>
   <main className="mx-auto max-w-lg space-y-4 px-4 py-8">
     <section className="flex flex-wrap gap-3">
       <button onClick={()=>setHidden(v=>!v)}>Hide figures</button>
       <button onClick={()=>document.documentElement.classList.toggle("dark")}>Theme</button>
       <button onClick={()=>setShowPlan(true)}>View plan</button>
       <label><input id="fail-save" type="checkbox" checked={fail} onChange={e=>setFail(e.target.checked)}/>Fail save</label>
       <label><input id="fail-refresh" type="checkbox" checked={refreshFail} onChange={e=>setRefreshFail(e.target.checked)}/>Fail refresh</label>
     </section>
     <output id="writes">{writes}</output><output id="proposal-id">{msg.proposal.proposal_id}</output>
     <ProposalConfirmCard msg={msg} onOpenDone={()=>setShowPlan(true)}
       onConfirm={()=>{setWrites(v=>v+1);setMsg(m=>({...m,status:"done"}));}}
       onCancel={()=>setMsg(m=>({...m,status:"cancelled"}))}
       onRevise={async(schedule,source)=>{
         setMsg(m=>({...m,status:"revising"}));
         const next=await previewSchedule(schedule);
         setMsg(m=>({...m,status:"pending",proposal:{...m.proposal,proposal_id:`revision-${Date.now()}`,params:{...m.proposal.params,schedule,schedule_preview:next,source_account_id:source,source_account_name:accounts.find(a=>a.id===source)?.name}}}));
       }} />
     {showPlan&&<CommitmentSheet commitment={record} initialMode="view" operations={operations}
       onClose={()=>setShowPlan(false)}
       onSaved={async()=>{if(refreshFailure.current){refreshFailure.current=false;setRefreshFail(false);throw Error("Synthetic refresh failure");}}} />}
   </main>
 </BalancesHiddenContext.Provider>;
}
