import assert from "node:assert/strict";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {JourneyBody,JourneyFooter} from "./JourneyScreens.tsx";
import {initialPlan,facts,sourceChoices,destinationChoices,SCENARIOS} from "./model.ts";
let cases=0;
for(const {id:scenario} of SCENARIOS){
  const saved=initialPlan(scenario);
  for(const step of ["purpose","kind","target","amount","source","destination","tracking","review","edit","view","pause","delete","result"]){
    const props={step,draft:saved,saved,scenario,facts:facts(scenario,saved),sources:sourceChoices(scenario),destinations:destinationChoices(scenario,saved),editing:true,error:"",result:"saved",onDraft:()=>{},onAction:()=>{}};
    const html=renderToStaticMarkup(React.createElement(React.Fragment,null,React.createElement(JourneyBody,props),React.createElement(JourneyFooter,props)));
    assert.doesNotMatch(html,/NaN|Infinity|—|count-existing/);
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
assert.match(html,/fresh forecast/);assert.match(html,/£300/);assert.match(html,/role="progressbar"/);
console.log(JSON.stringify({renderCases:cases,unknownQuote:"preserves saved progress without fabricating contribution",checks:"estimate labels, source-only separation, proposed Pause, save gating and finite figures passed"}));
