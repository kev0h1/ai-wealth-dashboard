import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, existsSync } from "node:fs";
import { AllocationPlanEditor } from "../components/AllocationPlanEditor.tsx";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";

const accounts = [{ id: "source", name: "Everyday account", provider: "Monzo", currency: "GBP", type: "bank", subtype: "CURRENT_ACCOUNT", balance: 1000, status: "active", manual: false }, { id: "pot", name: "Saving Challenge", provider: "Monzo", currency: "GBP", type: "bank", subtype: "SAVINGS_ACCOUNT", balance: 400, status: "active", manual: false }];
const base = { id: "aside", name: "Saving Challenge", amount_per_period: 376.6, remaining: 326.6, filled_this_period: 50, source_account_id: "source", fill_account_id: "pot", match_type: "description_contains", match_value: "CHALLENGE", fill_display_name: "Challenge", tracking_mode: "existing_payment", recurrence: "every_period", effective_from: "2026-08-28", period_start: "2026-10-01", period_end: "2026-10-31", active: true, pending: false, completed: false };
const render = (allocation, hidden = false, initialMode = "view", extra = {}) => renderToStaticMarkup(React.createElement(BalancesHiddenContext.Provider, { value: hidden }, React.createElement(AllocationPlanEditor, { allocation, accounts, periodStart: new Date("2026-10-01T12:00:00Z"), initialMode, onCancel() {}, onSaved() {}, onDeleted() {}, ...extra })));
let cases = 0;
for (const hidden of [false, true]) for (const scenario of ["payment", "manual", "suggested", "unavailable"]) {
  const item = { ...base };
  if (scenario === "manual") Object.assign(item, { tracking_mode: "manual", fill_account_id: "", match_value: "" });
  if (scenario === "suggested") item.source_account_id = null;
  if (scenario === "unavailable") item.source_account_id = "disconnected";
  const html = render(item, hidden, "view", { suggestedSourceId: "source" });
  assert.match(html, /Edit plan/); assert.match(html, /Pause plan/); assert.match(html, /Delete plan/);
  assert.doesNotMatch(html, /<details|<input|<select|NaN|Infinity|—/);
  if (hidden) assert.doesNotMatch(html, /£376|£326/);
  else assert.match(html, scenario === "payment" || scenario === "manual" ? /£326\.60/ : /£376\.60/);
  if (scenario === "suggested") { assert.match(html, /Everyday account/); assert.match(html, /Suggested from recent transfers/); assert.doesNotMatch(html, /held back|Paying account not linked/); }
  if (scenario === "unavailable") { assert.match(html, /Account details unavailable/); assert.doesNotMatch(html, /Suggested from recent transfers/); }
  if (scenario === "manual") assert.match(html, /Stays here/);
  cases++;
}
const editor = render(base, false, "edit");
assert.match(editor, /value="Saving Challenge"/);
assert.doesNotMatch(editor, /<details|More options|Back to summary|Keep these changes|Save changes|Pause plan|Delete plan|How we recognise it/);
assert.match(editor, /Back to plan/);
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
assert.equal(existsSync(new URL("../components/AllocationEditForm.tsx", import.meta.url)), false, "retired editor cannot be opened by another host");
for (const host of ["../components/AllocationSheet.tsx", "../components/upcoming/UpcomingDetailFlow.tsx"]) { assert.match(read(host), /<AllocationPlanEditor/); assert.doesNotMatch(read(host), /AllocationEditForm/); }
assert.doesNotMatch(read("../components/HomeBrief.tsx"), /AllocationEditForm/);
console.log(`G312: ${cases + 1} saved-view, suggestion, privacy and guided-entry cases passed`);
