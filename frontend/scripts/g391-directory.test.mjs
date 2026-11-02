// G391 directory semantics. Runs under the repository's TSX-aware Node test runner.
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AccountsDirectory, { directoryGroup, directoryRows } from "../components/AccountsDirectory.tsx";
import AccountAvailabilityDetail from "../components/AccountAvailabilityDetail.tsx";

const h = React.createElement;
const noop = () => {};
const row = (id, kind, balance, extra = {}) => ({
  id, name: `${kind} account ${id}`, provider: "Northbridge", kind, balance, status: "connected",
  pinned: false, dormant: false, attention: false, source: kind === "Investment" ? "investment" : "bank",
  raw: { id, name: `${kind} account ${id}`, provider: "Northbridge", type: kind, balance, currency: "GBP", status: "connected" }, ...extra,
});
const rows = [
  row("current", "Current", 1200, { pinned: true }), row("saving", "Savings", 200),
  row("credit", "Credit", -90), row("debt", "Debt", -500), row("investment", "Investment", 300),
  row("manual", "Current", 70, { raw: { id: "manual", name: "Manual", provider: "Northbridge", type: "current", manual: true, balance: 70, currency: "GBP", status: "connected" } }),
  row("dormant", "Savings", 0, { dormant: true }), row("unknown", "Current", Number.NaN),
];
const props = { rows, hidden: false, query: "", onQuery: noop, pinnedOnly: false, onPinnedOnly: noop, showDormant: true, onShowDormant: noop, collapsed: {}, onToggleGroup: noop, onOpen: noop };

assert.deepEqual(directoryRows(rows, { query: "northbridge credit", pinnedOnly: false, showDormant: true }).map(r => r.id), ["credit"], "search matches canonical kind and provider");
assert.deepEqual(directoryRows(rows, { query: "", pinnedOnly: true, showDormant: true }).map(r => r.id), ["current"], "pinned filter does not create a second band");
assert.ok(!directoryRows(rows, { query: "", pinnedOnly: false, showDormant: false }).some(r => r.id === "dormant"), "dormant stays hidden until requested");
assert.equal(directoryGroup(rows[5]), "Offline", "raw.manual determines Offline, not account name");
assert.equal(directoryGroup(rows[4]), "Investment", "typed canonical kinds stay canonical");

const html = renderToStaticMarkup(h(AccountsDirectory, props));
for (const label of ["Current", "Savings", "Credit cards", "Loans and mortgages", "Investments", "Offline"]) assert.ok(html.includes(`>${label}<`), `canonical ${label} group`);
assert.ok(html.includes("−£90"), "signed balance keeps U+2212");
assert.ok(html.includes('data-account-row-id="manual"'), "rows expose stable focus-return ids");
const unknownOnly = renderToStaticMarkup(h(AccountsDirectory, { ...props, rows: [rows.at(-1)] }));
assert.ok(unknownOnly.includes("Pending") && !unknownOnly.includes("£0"), "non-finite balances never become £0");
const masked = renderToStaticMarkup(h(AccountsDirectory, { ...props, hidden: true }));
assert.ok(masked.includes("−£••••") && !masked.includes("−£90"), "hidden negative keeps sign while masking value");
assert.ok(masked.includes("negative balance hidden") && !masked.includes("£90"), "masked aria output does not leak the amount");

const availability = renderToStaticMarkup(h(AccountAvailabilityDetail, {
  hidden: false,
  reading: { kind: "ready", value: 0, warning: "payments" },
  position: { after_payments: -289, after_payments_and_plans: -289, low_point: -289, plans_reserved: 0 },
}));
assert.ok(availability.includes("Available to spend") && availability.includes("£0") && availability.includes("Projected shortfall") && availability.includes("£289"), "detail keeps the available floor and native shortfall evidence");
assert.ok(availability.includes("Working") && availability.includes("After scheduled payments"), "detail exposes native working disclosure");
const pending = renderToStaticMarkup(h(AccountsDirectory, { ...props, rows: [rows[0]], syncFor: () => ({ kind: "new-bank" }) }));
assert.ok(pending.includes("Pending") && !pending.includes("£1,200"), "first sync withholds the synthetic stored balance");
const hiddenWorking = renderToStaticMarkup(h(AccountAvailabilityDetail, {hidden: true, reading: {kind: "ready", value: 0, warning: "payments"}, position: {low_point: -289, after_payments: -289}}));
assert.ok(!hiddenWorking.includes("289") && hiddenWorking.includes("−£••••"), "Working preserves signs without leaking hidden figures");
const unavailable = renderToStaticMarkup(h(AccountAvailabilityDetail, {hidden: false, reading: {kind: "unavailable"}}));
assert.ok(!unavailable.includes("£0") && !unavailable.includes("<details"), "unavailable estimate never fabricates a zero or working");
console.log("g391 directory semantics: ok");
