import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AGENT_DISCLOSURE } from "../lib/regulatoryCopy.ts";
import { fixtureBanks } from "../app/design/bank-picker/fixtures.ts";
import { buildDoc } from "../app/design/finexer-consent-intro/fixtures.ts";
import { BankChooser, ChosenBank, ConnectionNotice, ContinueAction, DIRECTIONS } from "../app/design/bank-consent-journeys/journeyParts.tsx";
import HostedConsentPreview, { buildHostedPreviewDoc } from "../app/design/bank-consent-journeys/HostedConsentPreview.tsx";
import { BankSearch, BankResults, BankMark, ConnectionNotice as ProductionNotice, ContinueAction as ProductionContinue } from "../components/bank-connect/BankConnectionParts.tsx";

const h = React.createElement;
const render = (component, props = {}) => renderToStaticMarkup(h(component, props));
const noop = () => {};
const banks = fixtureBanks("https://example.test");
const notice = render(ConnectionNotice);
assert.ok(notice.includes(AGENT_DISCLOSURE));
assert.match(notice, /text-\[13px\] leading-\[22px\]/);
assert.doesNotMatch(notice, /hidden|truncate|line-clamp|<details/);
assert.match(notice, /does not authorise a payment/);
assert.deepEqual(DIRECTIONS.map(x => x.id), ["g", "h", "i"]);
assert.match(DIRECTIONS[2].tradeoff, /Needs Finexer approval/);

const common = { banks, query: "", setQuery: noop, searchRef: { current: null }, onChoose: noop, selected: null };
const empty = render(BankChooser, common);
const typed = render(BankChooser, { ...common, query: "  mOnZo  " });
assert.equal((empty.match(/aria-label="Choose /g) ?? []).length, banks.length);
assert.equal((typed.match(/aria-label="Choose /g) ?? []).length, 1);
assert.match(typed, /aria-label="Choose Monzo"/);
assert.match(typed, /type="search"/);
assert.match(typed, /h-11 w-full[^\"]*text-base/);
assert.match(typed, /aria-label="Clear search"/);
assert.doesNotMatch(empty, /aria-label="Clear search"/);
assert.match(render(BankChooser, { ...common, query: "zzq" }), /No banks found/);
assert.match(render(BankChooser, { ...common, query: "zzq" }), /Show all banks/);
assert.match(empty, /data-journey-search[^>]*sticky top-0/);
assert.doesNotMatch(empty, /src=""/, "a missing fixture logo gets a neutral icon, not a broken image");
assert.match(render(ChosenBank, { bank: banks[0], onChange: noop }), /aria-label="Change bank"/);
assert.match(render(ContinueAction, { onContinue: noop }), /Continue to Finexer/);

// Approved G is production, not a second hand-authored mock. Its search is a
// fixed sibling of the scroller, so rows cannot paint above or behind it.
const productionNotice = render(ProductionNotice);
assert.equal(productionNotice, notice, "approved notice markup and full disclosure are unchanged");
const fixedSearch = render(BankSearch, common);
const filledSearch = render(BankSearch, { ...common, query: "Monzo" });
assert.match(fixedSearch, /data-journey-search[^>]*bg-white[^>]*dark:bg-slate-900/);
assert.doesNotMatch(fixedSearch, /sticky|fixed|absolute[^>]*data-journey-search/);
assert.match(filledSearch, /aria-label="Clear search"/);
assert.match(filledSearch, /h-11 w-full[^\"]*text-base/);
assert.equal((render(BankResults, common).match(/aria-label="Choose /g) ?? []).length, banks.length);
assert.equal((render(BankResults, { ...common, query: "  mOnZo  " }).match(/aria-label="Choose /g) ?? []).length, 1);
assert.match(render(BankResults, { ...common, loading: true }), /Loading banks/);
assert.match(render(BankResults, { ...common, error: "Try again", onRetry: noop }), /role="alert"/);
assert.match(render(BankResults, { ...common, banks: [] }), /No banks are available right now/);
assert.match(render(BankResults, { ...common, query: "zzq" }), /No banks found/);
assert.doesNotMatch(render(BankMark, { bank: { ...banks[0], logo: "" } }), /<img|src=""/);
assert.match(render(BankMark, { bank: { ...banks[0], logo: "/logo/provider/test-bank" } }), /\/logo\/provider\/test-bank/);
assert.match(render(ProductionContinue, { onContinue: noop, pending: true }), /disabled=""[^>]*aria-busy="true"/);
const readSource = relative => readFileSync(new URL(relative, import.meta.url), "utf8");
const productionFlow = readSource("../components/bank-connect/BankConnectionFlow.tsx");
assert.match(productionFlow, /bodyHeader: <BankSearch/);
assert.match(productionFlow, /body: <BankResults/);
assert.match(productionFlow, /onChoose=\{bank => \{ setSelected\(bank\); navigation.goTo\("review"\); \}\}/);
assert.match(productionFlow, /<ConnectionNotice \/>/);
assert.match(productionFlow, /onContinue=\{\(\) => onConnect\(selected, navigation.close\)\}/);
const sheet = readSource("../components/SheetFrame.tsx");
assert.ok(sheet.indexOf("data-sheet-body-header") > sheet.indexOf("</header>"));
assert.ok(sheet.indexOf("data-sheet-body-header") < sheet.indexOf("data-sheet-body className"));
const approvedPreview = readSource("../app/design/bank-consent-journeys/ApprovedGPreview.tsx");
assert.match(approvedPreview, /import BankConnectionFlow from "@\/components\/bank-connect\/BankConnectionFlow"/);
assert.match(approvedPreview, /<BankConnectionFlow banks=/);
assert.doesNotMatch(approvedPreview, /data-agent-disclosure|<input|<BankChooser|<ChosenBank/);

for (const mode of ["light", "dark"]) {
  const original = buildDoc(mode);
  const shell = original.slice(original.indexOf('<div class="fx-bar">'));
  for (const proposed of [false, true]) {
    const doc = buildHostedPreviewDoc(mode, proposed);
    assert.equal(doc.slice(doc.indexOf('<div class="fx-bar">')), shell, "provider permissions, controls and footer unchanged");
    assert.match(doc, /default-src 'none'/);
    assert.match(doc, /connect-src 'none'/);
    assert.match(doc, /form-action 'none'/);
    assert.doesNotMatch(doc, /<script|<form|https?:\/\//);
    if (proposed) {
      assert.equal(doc.split(AGENT_DISCLOSURE).length - 1, 1);
      assert.ok(doc.indexOf(AGENT_DISCLOSURE) < doc.indexOf('<div class="fx-bar">'));
      assert.doesNotMatch(doc, /<strong>Provided by Finexer Ltd<\/strong>/, "no repeated shortened regulatory intro");
    } else assert.equal(doc.includes(AGENT_DISCLOSURE), original.includes(AGENT_DISCLOSURE));
    const html = render(HostedConsentPreview, { mode, disclosureAtProvider: proposed, bankName: "Monzo", onBack: noop, onContinue: noop });
    assert.match(html, /sandbox="allow-same-origin"/);
    assert.doesNotMatch(html, /allow-scripts|allow-forms|allow-top-navigation/);
    assert.match(html, /Finexer step illustration/);
    assert.match(html, /Back in preview/);
    assert.match(html, /Continue preview/);
    if (proposed) assert.match(html, /Needs Finexer approval/);
  }
}
for (const file of ["ConsentJourneysClient.tsx", "journeyParts.tsx", "HostedConsentPreview.tsx", "ApprovedGPreview.tsx"]) {
  const source = readFileSync(new URL(`../app/design/bank-consent-journeys/${file}`, import.meta.url), "utf8");
  assert.doesNotMatch(source, /[—–]/, `${file}: no long dashes`);
  assert.doesNotMatch(source, /\b(?:fetch|axios)\s*\(|\bapi\.\w+\(/, `${file}: no live connection calls`);
}
console.log("a155-consent-journeys OK: disclosure, fixture picker, immutable hosted shell and no live actions");
