// G418: committed categories carry a comparison with their expected payments, never a pace multiple or "N× usual".
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { committedLine, MajorityRowView } from "../components/SpendVerdictView.tsx";

assert.equal(committedLine({ status: "as_expected", paid_count: 2, payments: [] }), "Paid as expected");
assert.equal(
  committedLine({ status: "higher", paid_count: 0, payments: [{ kind: "higher", name: "Acme Mortgage", paid: 1300, expected: 1124 }] }),
  "Acme Mortgage was £1,300, usually £1,124",
);
assert.equal(
  committedLine({ status: "new", paid_count: 0, payments: [{ kind: "new", name: "Bright Broadband", paid: 240 }, { kind: "new", name: "Other", paid: 20 }] }),
  "New payment: Bright Broadband, £240, and 1 more",
);
for (const c of [
  { status: "as_expected", paid_count: 1, payments: [] },
  { status: "higher", paid_count: 0, payments: [{ kind: "higher", name: "Acme Mortgage", paid: 1300, expected: 1124 }] },
  { status: "new", paid_count: 0, payments: [{ kind: "new", name: "Bright Broadband", paid: 240 }] },
]) {
  const text = committedLine(c);
  assert.ok(!/usual pace|times what you usually|× usual|—|!/.test(text), `no pace wording or banned punctuation: ${text}`);
}

const row = { category: "Mortgage", spent: 1124, payments_count: 1, has_baseline: false, elevated: false, committed: { status: "as_expected", paid_count: 1, payments: [] } };
const html = renderToStaticMarkup(h(MajorityRowView, { row, colours: {}, quietTag: false, onOpen() {}, tips: [] }));
assert.ok(html.includes("Paid as expected") && html.includes('data-committed="as_expected"'));
assert.ok(!/× usual|times what you usually/.test(html));
const plain = renderToStaticMarkup(h(MajorityRowView, { row: { ...row, committed: undefined }, colours: {}, quietTag: false, onOpen() {}, tips: [] }));
assert.ok(!plain.includes("data-committed"), "a discretionary row is unchanged");
console.log("g418-committed-pace ok");
