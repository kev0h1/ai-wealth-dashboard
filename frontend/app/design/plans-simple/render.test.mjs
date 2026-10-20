import assert from "node:assert/strict";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {JourneyBody,JourneyFooter} from "./JourneyScreens.tsx";
import {initialPlan,facts,sourceChoices,destinationChoices,SCENARIOS} from "./model.ts";
let cases=0;
for(const {id:scenario} of SCENARIOS){
  const saved=initialPlan(scenario);
  for(const step of ["purpose","kind","target","amount","source","destination","tracking","setup","review","edit","view","pause","delete","result"]){
    const props={step,draft:saved,saved,scenario,facts:facts(scenario,saved),sources:sourceChoices(scenario),destinations:destinationChoices(scenario,saved),editing:true,error:"",result:"saved",onDraft:()=>{},onAction:()=>{}};
    const html=renderToStaticMarkup(React.createElement(React.Fragment,null,React.createElement(JourneyBody,props),React.createElement(JourneyFooter,props)));
    assert.doesNotMatch(html,/NaN|Infinity|—|<select/);
    if(step==="setup"){assert.match(html,/data-g291-action="next-setup"/);assert.doesNotMatch(html,/data-g291-action="save"/);}
    if(step==="view"){assert.match(html,/data-g291-view-accounts/);assert.match(html,/data-g291-view-actions/);}
    if(saved.kind==="goal"&&["target","review","edit","view"].includes(step))assert.match(html,/estimated each pay period/);
    if(saved.kind==="set-aside"&&step==="view")assert.doesNotMatch(html,/Payment tracking|role="progressbar"/);
    if(saved.kind==="set-aside"&&["view","edit","review"].includes(step))assert.match(html,/Check Upcoming to see if it fits before payday/);
    if(scenario==="no-source"&&step==="edit")assert.doesNotMatch(html,/Use another account instead/);
    if(scenario==="no-source"&&step==="edit")assert.match(html,/data-g291-action="save" disabled/);
    if(saved.kind==="goal"&&step==="view")assert.match(html,/Goal pause is proposed/);
    cases++;
  }
}
const saved={...initialPlan("matched"),month:"2027-08"};
const html=renderToStaticMarkup(React.createElement(JourneyBody,{step:"view",draft:saved,saved,scenario:"matched",facts:facts("matched",saved),sources:sourceChoices("matched"),destinations:destinationChoices("matched",saved),editing:false,error:"",result:"saved",onDraft:()=>{},onAction:()=>{}}));
assert.match(html,/£90/);assert.match(html,/£300/);assert.match(html,/role="progressbar"/);
for(const kind of ["goal","set-aside"])for(const trackingMode of ["none","payment","category"]){
  const plan={...initialPlan(kind==="goal"?"matched":"one-account"),trackingMode,trackingConfirmed:true,categoryId:kind==="goal"?"savings":"groceries",includeExisting:kind==="goal"};
  for(const step of ["tracking","review","view","destination"]){
    const props={step,draft:plan,saved:plan,scenario:"matched",facts:facts("matched",plan),sources:sourceChoices("matched"),destinations:destinationChoices("matched",plan),editing:false,error:"",result:"saved",onDraft:()=>{},onAction:()=>{}};
    const body=renderToStaticMarkup(React.createElement(React.Fragment,null,React.createElement(JourneyBody,props),React.createElement(JourneyFooter,props)));
    assert.doesNotMatch(body,/NaN|Infinity|—|Skip for now/);
    if(step==="tracking"){assert.equal((body.match(/data-g291-action="confirm-tracking"/g)||[]).length,1,"one tracking footer");if(trackingMode==="category"){assert.match(body,/data-g291-category-picker/);assert.match(body,/name="tracking-category"/);assert.doesNotMatch(body,/<select/);}}
    if(step==="view"&&trackingMode==="category")assert.match(body,/category tracking/);
    cases++;
  }
}
const changedSource={...initialPlan("matched"),trackingMode:"category",categoryId:"savings",trackingConfirmed:false,sourceId:"monzo",sourceConfirmed:true};
const confirmation=renderToStaticMarkup(React.createElement(JourneyBody,{step:"edit",draft:changedSource,saved:changedSource,scenario:"matched",facts:facts("matched",changedSource),sources:sourceChoices("matched"),destinations:destinationChoices("matched",changedSource),editing:true,error:"",result:"saved",onDraft:()=>{},onAction:()=>{}}));
assert.match(confirmation,/Confirm Savings category/,"changed account scope visibly requires reconfirmation");
console.log(JSON.stringify({renderCases:cases+1,dateChange:"preserves saved progress and recalculates contribution",checks:"estimate labels, category/none/payment modes, source-only separation, proposed Pause, save gating and finite figures passed"}));
