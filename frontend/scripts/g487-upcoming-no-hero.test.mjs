// G487: Upcoming no longer carries the "Projected at payday" hero card. The page opens with
// By account (and its one quiet note), then Set aside this period, then the payment lists, and
// nothing else (tutorial, Penny, API client) still points at the removed card.
// Run: npm run -s check:g487-upcoming-no-hero
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../app/planning/PlanningPage.tsx");
const tutorial = read("../components/TutorialContext.tsx");
const api = read("../lib/api.ts");
const accountsCard = read("../components/upcoming/UpcomingAccountsCard.tsx");
const planCard = read("../components/upcoming/UpcomingPlansCard.tsx");

// 1. The hero is gone from the page and from the tree.
assert.equal(existsSync(new URL("../components/upcoming/UpcomingHeroCard.tsx", import.meta.url)), false, "the hero component is deleted");
assert.doesNotMatch(page, /UpcomingHeroCard/, "PlanningPage renders no hero card");
assert.doesNotMatch(page, /Projected at (payday|month end)/, "no projected-at heading on the page");
assert.doesNotMatch(page, /Savings backup|not included|Full calculation/, "no savings line or calculation on the page");
assert.doesNotMatch(page, /tutorial-planning-left/, "the hero's tutorial anchor is gone");
assert.doesNotMatch(page, /setPennyScreenView|buildUpcomingRunwayView/, "Upcoming publishes no runway figure to Penny");
assert.doesNotMatch(api, /cashflowWithForecast|include=forecast/, "the client no longer asks /cashflow for the embedded verdict");

// 2. The intro does not refer to the removed card.
const intro = page.match(/What will enter or leave[^<]*/)?.[0] ?? "";
assert.equal(intro, "What will enter or leave, and whether every payment is covered.");
assert.doesNotMatch(page, /forecast above/i, "no copy points up at a card that is not there");

// 3. The one note, as a quiet muted line, directly under By account.
const NOTE = "Payments can take a day or two to appear, so a very recent one may not be counted yet.";
assert.equal(page.split(NOTE).length - 1, 1, "the note is defined once");
assert.match(page, /function PaymentsLagNote\(\)[\s\S]{0,300}text-xs[\s\S]{0,60}text-slate-600 dark:text-slate-300">Payments can take/, "muted note styling");
const noteFn = page.slice(page.indexOf("function PaymentsLagNote"), page.indexOf("export default function PlanningPage"));
assert.doesNotMatch(noteFn, /—/, "no em dash in the note");

// 4. G489 E combines plans while keeping the account lead and payment order.
const mainAt = page.lastIndexOf("<UpcomingAccountsCard");
assert.ok(mainAt > 0);
const main = page.slice(mainAt);
const order = ["<UpcomingAccountsCard", "<PaymentsLagNote />", "<UpcomingPlansCard", 'data-tutorial-id="tutorial-planning-upcoming"'].map(needle => { const at=main.indexOf(needle); assert.ok(at>=0, `${needle} is in the populated branch`); return at; });
assert.deepEqual(order,[...order].sort((a,b)=>a-b));
assert.match(page.slice(mainAt-100,mainAt),/return\s*\(\s*<div[^>]*>\s*$/,"By account leads the body");
const emptyAt=page.indexOf("if (rawItems.length === 0)");
const empty=page.slice(emptyAt,page.indexOf('// "Spendable everywhere"',emptyAt));
const emptyOrder=["<UpcomingAccountsCard","<PaymentsLagNote />","<UpcomingPlansCard"].map(needle=>{const at=empty.indexOf(needle);assert.ok(at>=0,`empty branch has ${needle}`);return at;});
assert.deepEqual(emptyOrder,[...emptyOrder].sort((a,b)=>a-b));
assert.equal((page.match(/<UpcomingPlansCard\b/g)??[]).length,2);
assert.doesNotMatch(page,/<PlansSection|<UnlinkedGoalPlans/,"no duplicate old sections");
assert.match(page,/listedAccountSummaries\.length > 0 && <PaymentsLagNote \/>/,"no orphan note");

// 5. The tutorial no longer targets the hero, and every target it uses exists on the page.
const flow = tutorial.slice(tutorial.indexOf('id: "upcoming",'), tutorial.indexOf('id: "planning",'));
assert.ok(flow.length > 200, "upcoming tutorial flow found");
assert.doesNotMatch(tutorial, /tutorial-planning-left|upcoming-left|pay-period forecast/i, "no tutorial step or copy for the removed card");
const targets = [...flow.matchAll(/(?:target|fallbackTarget): "([^"]+)"/g)].map((m) => m[1]);
const sources = page + accountsCard + planCard;
for (const target of new Set(targets)) assert.ok(new RegExp(`data-tutorial-id=(?:"${target}"|\\{[^}]*"${target}")`).test(sources), `${target} is rendered by the Upcoming surface`);
assert.match(flow, /target: "tutorial-planning-accounts"/, "the first step explains By account");
assert.ok(flow.indexOf("tutorial-planning-accounts") < flow.indexOf("tutorial-planning-allocations"), "tour follows page order");
assert.match(page, /useTutorialReady\("upcoming", !firstSync\.pending && !firstSync\.active && \(!!cashflow \|\| cashflowError\)\)/, "readiness still waits for the cashflow that feeds By account");

console.log("g487-upcoming-no-hero: ok");
