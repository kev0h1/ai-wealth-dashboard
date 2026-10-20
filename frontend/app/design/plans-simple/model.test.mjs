import assert from "node:assert/strict";
import { applyDraft, facts, initialPlan, newDraft, sourceChoices, destinationChoices, parseMoney, money, validMonth, periodsLeft, categoryEvidence, CATEGORY_TRANSACTIONS, PRIMARY_COPY } from "./model.ts";
const saved=initialPlan("matched"), f=facts("matched",saved);
assert.equal(f.progressPence,30000);assert.equal(f.remainingPence,90000);assert.equal(f.slicePence,10000);assert.equal(f.reservePence,10000);
assert.equal(facts("matched",{...saved,transferConfirmed:false}).reservePence,10000,"rule confirmation is not a payment event");
assert.equal(facts("matched",{...saved,month:"2027-08"}).slicePence,9000,"ten future pay periods keep a visible estimate");
assert.equal(periodsLeft("2026-11"),1);assert.equal(periodsLeft("2027-07"),9);assert.equal(periodsLeft("2028-12"),26);assert.equal(periodsLeft("bad"),0);
const later=applyDraft(saved,{month:"2028-12"});assert.equal(later.progressPence,30000);assert.equal(facts("matched",later).slicePence,3500);assert.equal(facts("matched",later).progressPence,30000);
assert.equal(facts("matched",saved,true).reservePence,0);
assert.equal(facts("matched",applyDraft(saved,{name:"Trip"})).progressPence,30000,"simple edit preserves saved progress");
const route=applyDraft(saved,{sourceId:"monzo"});assert.equal(route.sourceConfirmed,false);assert.equal(route.transferConfirmed,false);assert.equal(route.progressPence,30000);
assert.equal(facts("matched",route).canSave,false,"suggestion must be confirmed");
assert.equal(facts("matched",route).hasCandidate,false,"new route cannot invent a past payment");
const pot=applyDraft(saved,{destinationId:"offline-pot"});assert.equal(pot.progressPence,0);assert.equal(pot.transferConfirmed,false);
const draft={...newDraft("matched"),name:"Trip",sourceConfirmed:true};assert.equal(facts("matched",draft).progressPence,0,"new goal never inherits the whole destination balance");assert.equal(facts("matched",{...draft,transferConfirmed:true}).progressPence,0,"confirming a rule cannot claim progress");
const included=applyDraft(draft,{includeExisting:true});assert.equal(facts("matched",included).progressPence,20000,"only the unclaimed share is offered");assert.equal(facts("matched",included).slicePence,11500);
assert.equal(facts("matched",applyDraft(included,{month:"2027-08"})).progressPence,20000,"date change preserves the choice");
assert.equal(facts("matched",applyDraft(included,{includeExisting:false})).progressPence,0,"include choice is reversible");
assert.equal(facts("matched",{...included,status:"active"}).progressPence,20000,"saving a draft does not add the free balance twice");
assert.equal(facts("matched",{...saved,includeExisting:true}).progressPence,50000,"existing claim and additional free share stay distinct");
assert.equal(facts("matched",{...included,targetPence:10000}).progressPence,10000,"no progress beyond target");
assert.equal(applyDraft(included,{destinationId:"offline-pot"}).includeExisting,false);
assert.equal(facts("offline",{...initialPlan("offline"),includeExisting:true}).availablePotPence,0,"offline balance is not freshly claimable");
const categoryAside={...initialPlan("one-account"),trackingMode:"category",categoryId:"groceries",trackingConfirmed:true};
assert.deepEqual(categoryEvidence(categoryAside),{count:4,pence:10000,grossPence:10500,refundPence:500,purchaseCount:3},"all eligible category spending, custom categories and refunds included");
const duplicateAndExcluded=[...CATEGORY_TRANSACTIONS,CATEGORY_TRANSACTIONS[0],
 {id:"other-account",date:"2026-10-10",accountId:"monzo",categoryId:"groceries",amountPence:9900,kind:"spend"},
 {id:"out-of-period",date:"2026-09-30",accountId:"natwest",categoryId:"groceries",amountPence:9900,kind:"spend"},
 {id:"claimed",date:"2026-10-10",accountId:"natwest",categoryId:"groceries",amountPence:9900,kind:"spend",claimedBy:"other-plan"},
 {id:"own-move",date:"2026-10-10",accountId:"natwest",categoryId:"groceries",amountPence:9900,kind:"transfer",destinationId:"holiday"},
 {id:"repayment",date:"2026-10-10",accountId:"natwest",categoryId:"groceries",amountPence:9900,kind:"card-repayment"},
 {id:"custom-wins",date:"2026-10-10",accountId:"natwest",categoryId:"groceries",customCategoryId:"savings",amountPence:9900,kind:"spend"}];
assert.deepEqual(categoryEvidence(categoryAside,duplicateAndExcluded),{count:4,pence:10000,grossPence:10500,refundPence:500,purchaseCount:3},"scope, duplicate, transfer and competing-plan guards");
assert.deepEqual(categoryEvidence({...saved,categoryId:"savings"}),{count:2,pence:15000,grossPence:15000,refundPence:0,purchaseCount:2},"goal only sees transfers to the selected pot, not another account");
assert.deepEqual(categoryEvidence({...saved,categoryId:"groceries"}),{count:0,pence:0,grossPence:0,refundPence:0,purchaseCount:0},"spending is not goal savings");
assert.equal(categoryEvidence(categoryAside,[{id:"refund-only",date:"2026-10-10",accountId:"natwest",categoryId:"groceries",kind:"refund",amountPence:-500}]).pence,-500,"net refunds retain their meaningful sign");
assert.equal(facts("matched",{...saved,trackingMode:"category",categoryId:"savings",trackingConfirmed:true}).reservePence,10000,"category evidence alone never fulfils a reserve");
assert.equal(facts("matched",{...saved,trackingMode:"category",categoryId:"savings",trackingConfirmed:true}).progressPence,30000,"category rule confirmation is not another pot deposit");
assert.equal(applyDraft(categoryAside,{categoryId:"savings"}).trackingConfirmed,false);
assert.equal(facts("one-account",{...categoryAside,trackingConfirmed:false}).canSave,false);
assert.equal(facts("one-account",{...categoryAside,trackingConfirmed:false}).canStartTracking,true,"unfinished tracking can be resumed from setup without weakening Save validation");
assert.equal(facts("one-account",{...categoryAside,sourceConfirmed:false}).canStartTracking,false,"setup still requires a confirmed account");
assert.equal(facts("one-account",{...categoryAside,amountPence:0}).canStartTracking,false,"setup still requires a valid amount");
assert.equal(facts("one-account",initialPlan("one-account")).reservePence,10000);assert.equal(initialPlan("one-account").destinationId,"");
assert.equal(sourceChoices("one-account").length,1);assert.equal(sourceChoices("no-source").length,0);
assert.equal(facts("no-source",initialPlan("no-source")).canSave,false);
assert.equal(facts("no-source",initialPlan("no-source")).reservePence,null,"no account means no asserted account reserve");
assert.ok(sourceChoices("matched").every(a=>!a.manual&&a.currency==="GBP"&&a.subtype==="TRANSACTION"&&a.include_in_safe_to_spend));
assert.ok(destinationChoices("matched",saved).every(a=>a.id!==saved.sourceId));
assert.equal(facts("no-history",initialPlan("no-history")).hasCandidate,false);assert.equal(facts("offline",initialPlan("offline")).hasCandidate,false);
assert.equal(initialPlan("offline").transferConfirmed,false);
assert.equal(facts("short",initialPlan("short")).shortfallPence,143700);assert.equal(facts("short",{...initialPlan("short"),targetPence:100000}).shortfallPence,null);
for(const amount of [0,-1,NaN,Infinity,100000001])assert.equal(facts("matched",{...saved,targetPence:amount}).canSave,false);
assert.equal(parseMoney("28.32"),2832);assert.equal(parseMoney("0.01"),1);for(const s of ["", "-5", "1.234", "abc"])assert.ok(Number.isNaN(parseMoney(s)));
assert.equal(money(-2832),"-£28.32");assert.equal(validMonth("2027-13"),false);assert.equal(validMonth("2026-10"),false);
assert.ok(PRIMARY_COPY.every(s=>!s.includes("—")));assert.doesNotMatch(PRIMARY_COPY.join(" "),/contains this|allocation|fulfilment/i);
// Transparent rough Flesch-Kincaid estimate, not a tested reading age.
const text=PRIMARY_COPY.join(" "), words=text.match(/[a-z]+(?:'[a-z]+)?/gi), sentences=text.match(/[.!?]+/g)?.length||PRIMARY_COPY.length;
const syllables=words.reduce((n,w)=>n+Math.max(1,(w.toLowerCase().replace(/e$/," ").match(/[aeiouy]+/g)||[]).length),0);
const grade=0.39*words.length/sentences+11.8*syllables/words.length-15.59;
assert.ok(grade<6,"primary questions remain simple");
console.log(JSON.stringify({checks:"monthly recalculation, explicit unclaimed pot share, category scope/refunds/deduplication, confirmation, progress, reserve and empty states passed",primaryCopy:{words:words.length,sentences,fleschKincaidGrade:Number(grade.toFixed(1)),method:"vowel-group syllable heuristic, not human testing"}}));
