import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SheetFrame } from "../components/SheetFrame.tsx";
import { useSavingsGoalEditor } from "../components/SavingsGoalSheet.tsx";
import { TransactionFilterSheetContent } from "../components/TransactionFilterSheet.tsx";

const source = path => readFileSync(new URL(path, import.meta.url), "utf8");
const frame = source("../components/SheetFrame.tsx");
const preview = source("../app/design/sheet-anatomy/SheetAnatomyClient.tsx");
const goals = source("../components/SavingsGoalSheet.tsx");
const filters = source("../components/TransactionFilterSheet.tsx");
const noop = () => {};
const operations = Object.fromEntries(["saveSavingsGoal", "addSavingsManualAccount", "updateSavingsManualAccount", "deleteSavingsManualAccount"].map(key => [key, async () => { throw new Error("Rendering must not call any operation"); }]));

assert.equal(renderToStaticMarkup(React.createElement(SheetFrame, {
  variant: "compact", title: "Fixture", onClose: noop, children: "Body", footer: "Save",
})), "", "Portal safely waits for a browser document during SSR");
assert.match(frame, /role="dialog"/);
assert.match(frame, /aria-modal="true"/);
assert.match(frame, /useId\(/);
assert.match(frame, /lockScroll: true, backToClose: true/);
assert.match(frame, /data-sheet-body className="min-h-0 flex-1 overflow-y-auto/);
assert.match(frame, /<header className="flex shrink-0/);
assert.match(frame, /<footer className="shrink-0/);
assert.match(frame, /safe-area-inset-bottom/);
assert.match(frame, /h-\[calc\(100dvh-1rem\)\]/);
assert.match(frame, /max-h-\[88dvh\]/);
assert.match(frame, /document.body/);
assert.match(frame, /z-\[70\]/);

function GoalHarness({ data, pinned = false, appearance = "legacy" }) {
  const editor = useSavingsGoalEditor({ data, sym: "£", hideValues: false, onSaved: noop, operations, appearance });
  return React.createElement("div", null, editor.body, editor.footer(noop, pinned));
}
const goal = { configured: true, target_type: "months", target_months: 6, monthly_spending: 1000,
  accounts: [{ account_id: "one", selected: true, name: "Example savings", provider: "Example", balance: 500, manual: false }] };
const normal = renderToStaticMarkup(React.createElement(GoalHarness, { data: goal }));
assert.match(normal, /aria-pressed="true"[^>]*>6 months/);
assert.match(normal, /6,000/);
assert.match(normal, /1 selected/);
assert.match(normal, /Update target/);
assert.doesNotMatch(normal, /disabled=""/);
const empty = renderToStaticMarkup(React.createElement(GoalHarness, { data: { ...goal, accounts: [] } }));
assert.match(empty, /Tap to choose where you keep your savings/);
assert.match(empty, /disabled=""/);
const invalid = renderToStaticMarkup(React.createElement(GoalHarness, { data: { ...goal, target_type: "amount", target_amount: 0 } }));
assert.match(invalid, /aria-label="Custom target amount"/);
assert.match(invalid, /disabled=""/);
const pinned = renderToStaticMarkup(React.createElement(GoalHarness, { data: goal, pinned: true }));
assert.match(pinned, /min-h-11 bg-indigo-600/);
assert.match(normal, /bg-emerald-600 text-white border-emerald-600/, "Live selected styling is unchanged");
const proposed = renderToStaticMarkup(React.createElement(GoalHarness, { data: goal, pinned: true, appearance: "sheet" }));
assert.match(proposed, /border-indigo-500 bg-indigo-50/);
assert.match(proposed, /font-mono tabular-nums/);
assert.match(goals, /appearance = "legacy"/);
assert.match(goals, /operations = api/);
assert.match(goals, /const before = new Set/);
assert.match(goals, /res.accounts.find\(a => !before.has\(a.account_id\)\)/);
assert.match(goals, /const accounts = data\?\.accounts \?\? \[\]/, "Account refreshes remain prop-driven");
assert.match(goals, /await operations.saveSavingsGoal\(body\);\s+onSaved\(\);\s+close\(\);/);
assert.match(goals, /editor.footer\(onClose\)/, "Incumbent goal Save still refreshes then closes");
assert.match(goals, /savingManual/);
assert.match(goals, /maxLength=\{60\}/);
assert.doesNotMatch(goals, /SheetFrame/, "Live goal shell does not opt in before approval");

const initial = { categories: ["Bills"], merchant: "Example shop", from: "2026-09-01", to: "2026-09-30", txnType: "debit" };
const filterHtml = renderToStaticMarkup(React.createElement(TransactionFilterSheetContent, {
  initial, categories: ["Bills", "Groceries"], onApply: noop, onClearAll: noop,
  formId: "test-filter", showActions: false, includeIntroduction: false,
}));
assert.match(filterHtml, /<form id="test-filter"/);
assert.match(filterHtml, /value="Example shop"/);
assert.match(filterHtml, /value="2026-09-01"/);
assert.match(filterHtml, /value="2026-09-30"/);
assert.match(filterHtml, /aria-pressed="true"[^>]*>Money out/);
assert.match(filterHtml, /aria-pressed="true"[^>]*>Bills/);
assert.doesNotMatch(filterHtml, /Show results/);
assert.match(filters, /onSubmit=\{submit\}/, "The pinned external form button submits the actual draft");
assert.doesNotMatch(filters, /<SheetFrame/, "Live filter shell is retained until approval");
assert.match(preview, /useSavingsGoalEditor/);
assert.match(preview, /TransactionFilterSheetContent/);
assert.doesNotMatch(preview, /\bapi\.|\bfetch\(/);
assert.match(preview, /editor.footer\(close, true\)/);
assert.match(preview, /form="g192-filter"/);
assert.match(preview, /FixtureBottomNav/);
console.log("G192 SSR, real form state, shared editor and unchanged live shell contracts passed");
