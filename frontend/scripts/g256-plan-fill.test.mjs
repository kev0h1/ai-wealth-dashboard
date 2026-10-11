// G256 (2026-10-11): a goal plan's fill rule. Pins that the Edit plan sheet REUSES
// the set-aside rule picker (no fork), the prefilled "Suggested from your transfers"
// label, the fulfilled / partial row copy, and that nothing is applied for the user.
//
// Run: npm run -s check:g256-plan-fill
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FillRulePicker } from "../components/AllocationFields.tsx";
import { fulfilmentRow, plansFromApi } from "../lib/upcomingPlans.ts";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const sheet = read("../components/CommitmentSheet.tsx");
const fields = read("../components/AllocationFields.tsx");
const api = read("../lib/api.ts");

// 1. Reuse, not fork: the sheet imports the shared picker and carries none of its own markup.
assert.match(sheet, /import \{ FillRulePicker[^}]*\} from "@\/components\/AllocationFields"/, "sheet imports the shared FillRulePicker");
assert.match(sheet, /<FillRulePicker/, "sheet renders the shared picker");
for (const own of ["Exactly this", "Contains this", "Type it in myself", "Pick from recent payments instead", "How strictly should this rule match?"]) {
  assert.ok(!sheet.includes(own), `sheet must not copy the picker's own markup: ${own}`);
  assert.ok(fields.includes(own), `picker still owns: ${own}`);
}
assert.match(fields, /Which payment fills it\?/, "the set-aside heading is unchanged");

// 2. Suggestion label, prefilled but never applied.
assert.match(sheet, /note=\{suggestedActive \? "Suggested from your transfers" : undefined\}/, "label shown only while the suggestion is untouched");
assert.match(sheet, /Nothing is saved until you do\./, "suggestion states it is not saved");
assert.match(sheet, /if \(ruleTouched \|\| \(sourceTouched && !sourceId\)\) body\.fill_rule = ruleBody/, "edit sends a rule only when touched");
assert.match(sheet, /\.\.\.\(ruleTouched \? \{ fill_rule: ruleBody \} : \{\}\)/, "create sends a rule only when touched");
assert.ok(!/useEffect\([^)]*updateCommitment/.test(sheet), "no auto-save of the suggestion");
const noop = () => {};
const html = renderToStaticMarkup(React.createElement(FillRulePicker, {
  accountId: "current", value: { match_type: "description_contains", match_value: "Japan pot", fill_display_name: "Japan pot" },
  onChange: noop, loadCandidates: async () => [], note: "Suggested from your transfers",
  emptyText: "No money has left this account in the last 90 days.", helperText: "A matching payment from this account counts as this period’s contribution.",
}));
assert.match(html, /Suggested from your transfers/, "picker renders the suggestion label");
assert.match(html, /Which payment fills it\?/, "picker keeps the set-aside heading");
const plain = renderToStaticMarkup(React.createElement(FillRulePicker, { accountId: "a", value: { match_type: "description_contains", match_value: "", fill_display_name: "" }, onChange: noop, loadCandidates: async () => [] }));
assert.ok(!/Suggested from your transfers/.test(plain), "no label without a suggestion");
assert.match(plain, /Only payments matching this count toward the envelope/, "set-asides keep their own helper text");

// 3. Row copy.
const base = { id: "goal:g", record_id: "g", kind: "goal", name: "Japan", destination: "Japan pot", destination_account_ids: ["pot"], source_account_id: "monzo", source_basis: "chosen", period_amount: 85, filled_amount: 80, remaining: 0, active: true };
const fulfilled = { state: "fulfilled", expected_pence: 8500, matched_pence: 8000, unmet_pence: 0, seen_in_sink: true, matched: [{ date: "2026-10-01", amount: 80, label: "To Japan pot" }] };
const [paid] = plansFromApi([{ ...base, fulfilment: fulfilled }]);
assert.deepEqual(fulfilmentRow(paid), { detail: "£80 set aside 1 Oct", status: "Paid this period", amount: "£0" });
const [part] = plansFromApi([{ ...base, remaining: 50, filled_amount: 30, period_amount: 80, fulfilment: { ...fulfilled, state: "partial", expected_pence: 8000, matched_pence: 3000, unmet_pence: 5000, matched: [{ date: "2026-10-02", amount: 30, label: "x" }] } }]);
assert.deepEqual(fulfilmentRow(part), { detail: "£30 of £80 set aside", status: "to set aside", amount: "−£50" });
const [none] = plansFromApi([{ ...base, remaining: 85, filled_amount: 0, fulfilment: { ...fulfilled, state: "unmet", matched_pence: 0, unmet_pence: 8500, matched: [] } }]);
assert.equal(fulfilmentRow(none), null, "no match yet reads as today's 'to set aside'");
assert.equal(fulfilmentRow(plansFromApi([base])[0]), null, "no rule, nothing changes");
assert.equal(fulfilmentRow({ ...paid, active: false }), null);
assert.equal(paid.remainingPence, 0, "a fulfilled plan reserves nothing on the account");

// 4. Copy rules over everything this item adds.
for (const text of [sheet.slice(sheet.lastIndexOf("G256: the payment that fulfils"), sheet.indexOf("Live per-period estimate")), fulfilmentRow.toString(), api.slice(api.indexOf("G256: the same fill rule"), api.indexOf("export type Commitment = {"))]) {
  assert.ok(!/—/.test(text), "no em dashes");
}
assert.ok(!/!["'`<]/.test(sheet.slice(sheet.indexOf("plan-fill-rule-field"), sheet.indexOf("plan-fill-rule-field") + 2600)), "no exclamation marks");
assert.ok(!/undo/i.test(sheet.slice(sheet.indexOf("plan-fill-rule-field"), sheet.indexOf("plan-fill-rule-field") + 2600)), "no undo control");
console.log("g256 plan fill: ok");
