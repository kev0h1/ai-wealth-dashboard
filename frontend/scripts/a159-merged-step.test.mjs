// A159 (approved B): the production consent path with the CONSENT_MERGED_STEP flag
// off (identical to the shipped A155 G flow) and on (pinned line, hand-off at once).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AGENT_DISCLOSURE } from "../lib/regulatoryCopy.ts";
import BankConnectionFlow from "../components/bank-connect/BankConnectionFlow.tsx";
import { MergedNotice, MERGED_SUMMARY, ConnectionNotice, ContinueAction } from "../components/bank-connect/BankConnectionParts.tsx";
import { pickerMergedStep } from "../components/BankPickerSheet.tsx";

const h = React.createElement;
const html = node => renderToStaticMarkup(node);
const banks = [{ id: "b1", name: "Monzo", logo: "" }, { id: "b2", name: "Starling", logo: "" }];

// Capture the flow's renderView by calling the component inside a real render (hooks need one).
function capture(props) {
  let renderView;
  function Probe() { renderView = BankConnectionFlow({ banks, loading: false, loadError: null, connectionError: null, connecting: null, onRetry() {}, onConnect() {}, onClose() {}, ...props }).props.renderView; return null; }
  renderToStaticMarkup(h(Probe));
  return renderView;
}
const calls = { goTo: [], connect: [] };
const nav = { goTo: v => calls.goTo.push(v), back() {}, close() {}, returnTo: () => false, canReturnTo: () => false };
const parts = v => `${html(h("div", null, v.bodyHeader))}${html(h("div", null, v.body))}${html(h("div", null, v.footer))}`;

// The flag: default off, on only for the pinned line.
assert.equal(pickerMergedStep(false), undefined);
assert.equal(pickerMergedStep(true), "pinned-line");
if (process.env.NEXT_PUBLIC_CONSENT_MERGED_STEP === undefined) assert.equal(pickerMergedStep(), undefined, "the flag defaults off with no env var set");
else assert.equal(pickerMergedStep(), process.env.NEXT_PUBLIC_CONSENT_MERGED_STEP === "on" ? "pinned-line" : undefined);
const picker = readFileSync(new URL("../components/BankPickerSheet.tsx", import.meta.url), "utf8");
assert.match(picker, /mergedStep=\{pickerMergedStep\(\)\}/, "BankPickerSheet passes the flag-derived step to BankConnectionFlow");
assert.match(readFileSync(new URL("../lib/featureFlags.ts", import.meta.url), "utf8"), /NEXT_PUBLIC_CONSENT_MERGED_STEP === "on"/);

// Flag off: choose, then review, then Continue to Finexer. The sentence is on the review step.
const off = capture({ mergedStep: pickerMergedStep(false), onConnect: (b, c) => calls.connect.push(b) });
const offChoose = off("choose", nav);
assert.match(parts(offChoose), /Next: review how this connection works\./);
offChoose.body.props.onChoose(banks[0]);
assert.deepEqual(calls.goTo, ["review"], "off: a bank tap opens the review step");
assert.equal(calls.connect.length, 0, "off: a bank tap does not hand off");
// The review step needs a chosen bank held in state, so check its pieces and the flow source.
const flowSrc = readFileSync(new URL("../components/bank-connect/BankConnectionFlow.tsx", import.meta.url), "utf8");
assert.match(flowSrc, /title: "Review your connection"/);
assert.match(flowSrc, /if \(mergedStep\) \{[\s\S]*?\n    \}\n    if \(view === "choose" \|\| !selected\)/, "the merged branch sits before, and leaves intact, the G flow");
const offReview = html(h(ConnectionNotice)) + html(h(ContinueAction, { onContinue() {} }));
assert.match(offReview, /Continue to Finexer/);
assert.ok(offReview.includes(AGENT_DISCLOSURE), "off: the full sentence is on the review step");

// Flag on: a bank tap hands off at once, no review step, pinned line plus expander.
const calls2 = { goTo: [], connect: [] };
const nav2 = { ...nav, goTo: v => calls2.goTo.push(v) };
const on = capture({ mergedStep: pickerMergedStep(true), onConnect: (b, c) => calls2.connect.push([b.id, c]) });
const onChoose = on("choose", nav2);
const onHtml = parts(onChoose);
assert.match(onHtml, /data-merged-notice="pinned-line"/);
assert.ok(onHtml.includes("AURIQ LTD acts as an agent of Finexer LTD, which is FCA authorised"));
assert.match(onHtml, /aria-expanded="false"/);
assert.match(onHtml, /id="merged-notice-region" hidden/);
assert.ok(onHtml.includes(AGENT_DISCLOSURE), "on: the full sentence is in the expander, verbatim");
assert.doesNotMatch(onHtml, /Continue to Finexer|Review your connection|Next: review/);
assert.match(onHtml, /min-h-11/, "on: the toggle is a 44px target");
onChoose.body.props.onChoose(banks[1]);
assert.equal(calls2.connect.length, 1, "on: one bank tap hands off");
assert.equal(calls2.connect[0][0], "b2");
assert.deepEqual(calls2.goTo, [], "on: no review step");
// pending status and the open state are not persisted anywhere
assert.match(html(h(MergedNotice, { pending: true })), /Opening Finexer/);
assert.match(html(h(MergedNotice, { defaultOpen: true })), /aria-expanded="true"/);
assert.doesNotMatch(readFileSync(new URL("../components/bank-connect/BankConnectionParts.tsx", import.meta.url), "utf8").match(/export function MergedNotice[\s\S]*$/)[0], /localStorage|sessionStorage/);
assert.doesNotMatch(html(h(MergedNotice, {})) + MERGED_SUMMARY, /[—–!]/);
console.log("a159-merged-step OK");
