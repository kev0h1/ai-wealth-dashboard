import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AGENT_DISCLOSURE } from "../lib/regulatoryCopy.ts";
import { MergedNotice, MERGED_SUMMARY } from "../components/bank-connect/BankConnectionParts.tsx";

const h = React.createElement;
const html = (props) => renderToStaticMarkup(h(MergedNotice, props));
// A4.1 sentence verbatim and in full in every merged placement, with no clipping.
for (const mode of ["footer", "pinned-line", "header"]) {
  const out = html({ mode });
  assert.ok(out.includes(AGENT_DISCLOSURE), `${mode} must render the full A4.1 sentence`);
  assert.doesNotMatch(out, /truncate|line-clamp|text-\[1[01]px\]|text-xs[^"]*"[^>]*data-agent-disclosure/);
  assert.ok(MERGED_SUMMARY.includes("Finexer"), "summary names Finexer so the hand-off is signposted");
}
// Only the pinned line collapses the sentence, and its region is wired to a real button.
assert.match(html({ mode: "pinned-line" }), /aria-expanded="false"[^>]*aria-controls="merged-notice-region"|aria-controls="merged-notice-region"[^>]*aria-expanded="false"/);
assert.match(html({ mode: "pinned-line", defaultOpen: true }), /aria-expanded="true"/);
assert.doesNotMatch(html({ mode: "footer" }), /hidden=""/);
assert.doesNotMatch(html({ mode: "header" }), /hidden=""/);
// Status wording, no em dashes.
assert.match(html({ mode: "footer", pending: true }), /Opening Finexer/);
assert.doesNotMatch(html({ mode: "footer" }) + MERGED_SUMMARY, /[—–!]/);
console.log("a159-merged-step OK");
