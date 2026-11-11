// G453: real TeachingSheet browser regression with an in-memory API fixture.
// It deliberately serves the app globals, component CSS module and local fonts.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { openBrowser } from "./_plan-browser.mjs";

const out = await mkdtemp(path.join(tmpdir(), "g453-teaching-"));
const evidence = path.resolve("../.impeccable/review/g453");
await mkdir(evidence, { recursive: true });

const entry = `
import React from "react";
import { createRoot } from "react-dom/client";
import TeachingSheet from "./components/TeachingSheet";
import { api } from "@/lib/api";

window.fixture = {
  calls: [], updates: [], countReads: 0, refreshes: 0, removes: 0,
  mode: "ok", scopeFail: false, refreshFail: false, hidden: false, generation: 0,
  counts: { one_count: 1, earlier_count: 2, history_count: 3, all_count: 5, protected_count: 0, selected_protected: false, can_save_rule: true },
};
api.correctionScope = async () => {
  window.fixture.countReads += 1;
  if (window.fixture.scopeFail) { window.fixture.scopeFail = false; throw Error("offline"); }
  return window.fixture.counts;
};
api.applyCorrection = async (id, request) => {
  window.fixture.calls.push({ id, ...request });
  if (window.fixture.mode === "fail-once") { window.fixture.mode = "ok"; throw Error("offline"); }
  const ids = request.scope === "one" ? ["t"] : request.scope === "history" ? ["old"] : ["t", "old", "future"];
  const category = request.category ?? ({
    "mine-card": "Debt", "mine-savings": "Savings", "mine-investment": "Investment",
    "mine-here": "Transfer", "mine-goal": "Transfer", "mine-offline": "Transfer",
  }[request.resolution] ?? "Transfer");
  return {
    category,
    updated_count: request.expected_count, affected_ids: ids,
    protected_count: window.fixture.counts.protected_count,
    rule_id: request.scope === "history-future" ? "rule-1" : null,
    refresh_pending: window.fixture.mode === "refresh", rule_conflict: null,
  };
};
api.undoCorrection = async (id, operationId, defer) => {
  window.fixture.calls.push({ kind: "undo", id, operationId, defer });
  return { updated_count: 2, restored_categories: { t: "Transfer", old: "Bills" }, refresh_pending: false };
};
api.refreshCorrection = async () => {
  window.fixture.refreshes += 1;
  if (window.fixture.refreshFail) { window.fixture.refreshFail = false; throw Error("offline"); }
  return { refresh_pending: false };
};
api.getRules = async () => ({ rules: [{ id: "rule-1", description: "Private transfer", category: "Debt" }] });
api.deleteRule = async () => { window.fixture.removes += 1; };
api.listCommitments = async () => ({ items: [{id:"goal-1", name:"Holiday", status:"active"}] });
api.getCategories = async () => ({ all: ["Other", "Transfer", "Income", "Debt", "Savings", "Investment", "Groceries"], custom: [], kinds: { Transfer: "movement", Income: "income", Debt: "commitment", Savings: "movement", Investment: "movement", Groceries: "discretionary" } });
const root = createRoot(document.getElementById("root"));
window.render = (credit = false, defer = false) => root.render(
  <TeachingSheet
    key={++window.fixture.generation}
    transaction={{ id: "t", description: "Private transfer", category: "Transfer", amount: 25, currency: "GBP", date: "2026-11-09", transaction_type: credit ? "credit" : "debit" }}
    forceMovementRoot
    deferRecompute={defer}
    onClose={() => { window.fixture.closed = (window.fixture.closed || 0) + 1; }}
    onUpdated={(...args) => window.fixture.updates.push(args)}
  />
);
window.render();
`;

const stubs = {
  "next/navigation": `export const useRouter=()=>({push(){},replace(){},back(){}});export const usePathname=()=>"/";export const useSearchParams=()=>new URLSearchParams();`,
  "next/link": `export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`,
  "@/components/CategoriesContext": `export const useCategories=()=>({
    allCategories:["Other","Transfer","Income","Debt","Savings","Investment","Groceries","Bills"],
    customCategories:[], kinds:{Transfer:"movement",Income:"income",Debt:"movement",Savings:"movement",Investment:"movement"},
    addCategory:async()=>{}
  });`,
  "@/components/PreferencesContext": `export const usePreferences=()=>({hideNetWorth:window.fixture.hidden,preferencesReady:true});`,
  "@/lib/api": `export class ApiError extends Error{constructor(status,detail,message){super(message);this.status=status;this.detail=detail}};export const api={};`,
  "@/lib/cacheInvalidation": `export const invalidateAfterTransactionCorrection=()=>{};export const notifyTransactionsChanged=()=>{};`,
  "@/components/CommitmentSheet": `export default function CommitmentSheet(){return null;}`,
  "@/components/CategoryIconPicker": `export default function CategoryIconPicker(){return null;}`,
  "@/components/AccountMiniCard": `export const accountBrand=()=>null;export function BankBadge(){return null;}`,
};
await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true,
  loader: { ".css": "local-css" },
  outfile: path.join(out, "bundle.js"),
  jsx: "automatic",
  define: { "process.env": "{}" },
  plugins: [{ name: "g453-fixtures", setup(build) {
    build.onResolve({ filter: /^(next\/navigation|next\/link|@\/components\/(PreferencesContext|CategoriesContext|CommitmentSheet|CategoryIconPicker|AccountMiniCard)|@\/lib\/(api|cacheInvalidation))$/ }, args => ({ path: args.path, namespace: "g453" }));
    build.onLoad({ filter: /.*/, namespace: "g453" }, args => ({ contents: stubs[args.path], loader: "jsx", resolveDir: process.cwd() }));
  } }],
});
const globals = await readFile("app/globals.css", "utf8");
const tailwindCss = (await postcss([tailwind({ base: process.cwd() })]).process(globals, { from: path.resolve("app/globals.css") })).css;
const moduleCss = await readFile(path.join(out, "bundle.css"), "utf8");
await writeFile(path.join(out, "styles.css"), `${tailwindCss}\n${moduleCss}`);
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>@font-face{font-family:Figtree;src:url(/fonts/Figtree.ttf)}@font-face{font-family:JetBrains;src:url(/fonts/JetBrainsMono.ttf)}:root{--font-figtree:Figtree;--font-jbmono:JetBrains}body{margin:0;background:#f0f2f7}.dark body{background:#0f172a}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`;
const server = createServer(async (request, response) => {
  try {
    const url = request.url ?? "/";
    if (url === "/bundle.js" || url === "/styles.css") {
      response.setHeader("Content-Type", url.endsWith(".css") ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8");
      return response.end(await readFile(path.join(out, url.slice(1))));
    }
    if (url.startsWith("/fonts/")) {
      response.setHeader("Content-Type", "font/ttf");
      return response.end(await readFile(path.join(process.cwd(), "public/design-media/c22/crafted/fonts", path.basename(url))));
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(html);
  } catch {
    response.statusCode = 404;
    response.end("missing");
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

const browser = await openBrowser({ origin: `http://127.0.0.1:${server.address().port}`, output: evidence });
const button = label => `(() => {
  const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1);
  const buttons = [...(dialog ?? document).querySelectorAll('button:not(:disabled)')];
  return buttons.find(element => element.textContent.trim() === ${JSON.stringify(label)})
    ?? buttons.find(element => element.textContent.trim().startsWith(${JSON.stringify(label)}));
})()`;
const waitFor = async expression => {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (await browser.evaluate(`!!(${expression})`)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error(`Timed out waiting for ${expression}`);
};
const click = async label => {
  const selector = button(label);
  await waitFor(selector);
  await browser.settle();
  await browser.activate(selector, false);
};
const clickContaining = async label => {
  const selector = buttonContaining(label);
  await waitFor(selector);
  await browser.settle();
  await browser.activate(selector, false);
};
const chooseScope = async value => {
  const selector = `document.querySelector('input[value="${value}"]:not(:disabled)')`;
  await waitFor(selector);
  await browser.settle();
  await browser.activate(selector, false);
  await waitFor(`document.querySelector('input[value="${value}"]').checked`);
};
const openCardReview = async () => {
  await click("Paying off one of my cards");
  await waitFor("document.body.innerText.includes('How far should this apply?')");
  await waitFor("!document.querySelector('input[value=one]').disabled");
};

try {
  await browser.viewport(390, 844);
  await browser.navigate("/", "document.body.innerText.includes('Where did this money go?')");
  assert.equal(await browser.evaluate("window.fixture.calls.length"), 0, "there is no mutation before Apply");
  await openCardReview();
  assert.equal(await browser.evaluate("document.querySelector('input[value=one]').checked"), true, "one is the default scope");
  await browser.activate("document.querySelector('input[value=one]')");
  await browser.key("ArrowDown", "ArrowDown", 40);
  await waitFor("document.querySelector('input[value=history]').checked");
  await browser.activate("document.querySelector('input[value=one]')");

  await click("Change classification");
  await waitFor("document.activeElement?.tagName==='H2' && document.body.innerText.includes('Where did this money go?')");
  await openCardReview();

  // Unknown outcome: the sheet stays open and Retry sends the same receipt id.
  await browser.evaluate("window.fixture.mode='fail-once'");
  await click("Update 1 payment");
  await waitFor("document.body.innerText.includes('could not be confirmed')");
  assert.equal(await browser.evaluate("window.fixture.updates.length"), 0, "a failed write does not notify");
  await click("Retry update");
  await waitFor("document.body.innerText.includes('Updated 1')");
  assert.equal(await browser.evaluate("window.fixture.calls[0].operation_id===window.fixture.calls[1].operation_id"), true);
  assert.equal(await browser.evaluate("window.fixture.updates[0][0].category"), "Debt");

  // The server’s restored map becomes two exact host updates, in map order.
  await click("Undo correction");
  await waitFor("document.body.innerText.includes('Restored 2')");
  assert.deepEqual(await browser.evaluate("window.fixture.updates.slice(-2).map(update=>[update[0].id,update[0].category,update[2]])"), [["t", "Transfer", true], ["old", "Bills", true]]);

  // Count failure is recoverable in the scope sheet.
  await browser.evaluate("window.fixture.scopeFail=true;window.render()");
  await waitFor("document.body.innerText.includes('Where did this money go?')");
  await click("Paying off one of my cards");
  await waitFor("document.body.innerText.includes('Check again')");
  await click("Check again");
  await waitFor("!document.querySelector('input[value=one]').disabled");

  // A protected selected payment is not in the history payload or host updates.
  await browser.evaluate(`window.fixture.counts={one_count:0,earlier_count:2,history_count:2,all_count:4,protected_count:3,selected_protected:true,can_save_rule:true};window.fixture.updates=[];window.render()`);
  await waitFor("document.body.innerText.includes('Where did this money go?')");
  await click("Paying off one of my cards");
  await waitFor("document.body.innerText.includes('This payment is protected')");
  assert.equal(await browser.evaluate("document.querySelector('input[value=one]').disabled"), true);
  await chooseScope("history");
  await click("Update 2 payments");
  await waitFor("document.body.innerText.includes('Updated 2')");
  assert.equal(await browser.evaluate("window.fixture.calls.at(-1).scope"), "history");
  assert.deepEqual(await browser.evaluate("window.fixture.updates.map(update=>update[0].id)"), ["old"]);

  // Future scope creates a typed rule and opens/removes it through the shared panel.
  await browser.evaluate(`window.fixture.counts={one_count:1,earlier_count:2,history_count:3,all_count:5,protected_count:0,selected_protected:false,can_save_rule:true};window.render()`);
  await waitFor("document.body.innerText.includes('Where did this money go?')");
  await openCardReview();
  await chooseScope("history-future");
  await click("Update 5 payments");
  await waitFor("document.body.innerText.includes('View future rule')");
  await click("View future rule");
  await waitFor("document.body.innerText.includes('Future filing rule')");
  await waitFor("document.body.innerText.includes('Private transfer')");
  await click("Remove rule");
  await waitFor("document.activeElement?.textContent.trim()==='Keep rule'");
  await click("Keep rule");
  await waitFor("document.activeElement?.textContent.trim()==='Remove rule'");
  await click("Remove rule");
  await click("Remove rule");
  await waitFor("window.fixture.removes===1");
  assert.equal(await browser.evaluate("window.fixture.removes"), 1);
  await waitFor("document.activeElement?.textContent.includes('Future filing rule removed')");

  // Refresh failure is a retry-only concern: the saved correction is not sent again.
  await browser.evaluate("window.fixture.mode='refresh';window.fixture.refreshFail=true;window.render()");
  await waitFor("document.body.innerText.includes('Where did this money go?')");
  await openCardReview();
  await click("Update 1 payment");
  await waitFor("document.body.innerText.includes('Refresh figures')");
  const writesBeforeRefresh = await browser.evaluate("window.fixture.calls.filter(call=>!call.kind).length");
  await click("Refresh figures");
  await waitFor("document.body.innerText.includes('Try refreshing the figures again')");
  await click("Refresh figures");
  await waitFor("!document.body.innerText.includes('Refresh figures')");
  assert.equal(await browser.evaluate("window.fixture.calls.filter(call=>!call.kind).length"), writesBeforeRefresh);
  assert.equal(await browser.evaluate("window.fixture.refreshes"), 2);

  // Deferred batches retain their no-per-tap refresh contract.
  await browser.evaluate("window.fixture.mode='ok';window.render(false,true)");
  await waitFor("document.body.innerText.includes('Where did this money go?')");
  await openCardReview();
  await chooseScope("history-future");
  await click("Update 5 payments");
  await waitFor("document.body.innerText.includes('Updated 5')");
  assert.equal(await browser.evaluate("window.fixture.calls.at(-1).defer_recompute"), true);

  // Savings and investments have no destination naming step; the credit path is safe.
  await browser.evaluate("window.fixture.hidden=true;window.render()");
  await waitFor("document.body.innerText.includes('Where did this money go?')");
  assert.match(await browser.evaluate("document.body.innerText"), /−£••••/);
  await click("Savings or investments");
  await click("Investment");
  await waitFor("document.body.innerText.includes('How far should this apply?')");
  assert.equal(await browser.evaluate("document.querySelector('input[type=text]')"), null);
  await browser.navigate("/", "document.body.innerText.includes('Where did this money go?')");
  await browser.evaluate("window.fixture.hidden=false;window.render(true)");
  await waitFor("document.body.innerText.includes('Money arrived. Where is it from?')");
  assert.equal(await browser.evaluate("document.body.innerText.includes('Paying off one of my cards')"), false);

  // Each debit resolution opens one shared review before it can write.
  for (const [choices, category] of [
    [["Another of my accounts in Sorted"], "Transfer"],
    [["Paying off one of my cards"], "Debt"],
    [["Savings or investments", "Savings"], "Savings"],
    [["Savings or investments", "Investment"], "Investment"],
    [["A goal in Sorted", "Holiday"], "Transfer"],
    [["An account Sorted can't see", "Use this account"], "Transfer"],
    [["Spending", "Groceries"], "Groceries"],
  ]) {
    await browser.evaluate("window.render()");
    await waitFor("document.body.innerText.includes('Where did this money go?')");
    for (const choice of choices) await click(choice);
    await waitFor(`document.body.innerText.includes(${JSON.stringify("Change to " + category)})`);
    assert.equal(await browser.evaluate("document.querySelectorAll('input[type=radio]').length"), 3);
    assert.equal(await browser.evaluate("document.querySelector('input[value=one]').checked"), true);
  }

  // Capture the approved review, with the amount both shown and hidden.
  for (const [width, dark, hidden] of [[390,false,false],[390,true,false],[390,true,true],[320,false,false],[1440,false,false],[1440,true,false]]) {
    await browser.viewport(width, 844);
    await browser.evaluate(`window.fixture.hidden=${hidden};document.documentElement.className=${JSON.stringify(dark ? "dark" : "")};window.render()`);
    await waitFor("document.body.innerText.includes('Where did this money go?')");
    await click("Savings or investments");
    await click("Savings");
    await chooseScope("history");
    await browser.evaluate("document.querySelector('[data-sheet-body]').scrollTop=0");
    assert.equal(await browser.evaluate("document.documentElement.scrollWidth>innerWidth"), false);
    if (hidden) assert.match(await browser.evaluate("document.body.innerText"), /−£••••/);
    await browser.shot(`teaching-${width}-${dark ? "dark" : "light"}${hidden ? "-hidden" : ""}`);
  }
  assert.deepEqual(browser.exceptions, []);
  assert.deepEqual(browser.apiRequests, []);
  await browser.save("result", { passed: true, evidence, coverage: ["one/history/history-future", "count/write/refresh retry", "server Undo", "protected", "future rule removal", "privacy", "credit"] });
  console.log("G453 TeachingSheet browser checks passed");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
