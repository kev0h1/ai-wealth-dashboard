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
const flow = source("../components/UpcomingFlowSheet.tsx");
const category = source("../components/CategorySheet.tsx");
const commitment = source("../components/CommitmentSheet.tsx");
const insight = source("../components/InsightCard.tsx");
const setAside = source("../components/SetAsideSheet.tsx");
const accountsPage = source("../app/components/AccountsPage.tsx");
const accountHistoryHook = source("../lib/useAccountDetailHistory.ts");
const contractExamples = source("../app/design/sheet-anatomy/SheetContractExamples.tsx");
const noop = () => {};
const operations = Object.fromEntries(["saveSavingsGoal", "addSavingsManualAccount", "updateSavingsManualAccount", "deleteSavingsManualAccount"].map(key => [key, async () => { throw new Error("Rendering must not call any operation"); }]));

assert.equal(renderToStaticMarkup(React.createElement(SheetFrame, {
  variant: "compact", title: "Fixture", onClose: noop, children: "Body", footer: "Save",
})), "", "Portal safely waits for a browser document during SSR");
assert.match(frame, /role="dialog"/);
assert.match(frame, /aria-modal="true"/);
assert.match(frame, /useId\(/);
assert.match(frame, /lockScroll: true, backToClose: manageHistory/);
assert.match(frame, /data-sheet-body className=\{`min-h-0 flex-1 overflow-y-auto/);
assert.match(frame, /<header ref={headerRef} className="flex shrink-0/);
assert.match(frame, /<footer data-sheet-footer className="shrink-0/);
assert.match(frame, /safe-area-inset-bottom/);
assert.match(frame, /variant = "focused"/);
assert.match(frame, /safe-area-inset-top/);
assert.match(frame, /visualViewport/);
assert.match(frame, /max-h-\[88%\]/);
assert.match(frame, /document.body/);
assert.match(frame, /z-\[70\]/);


// G205: swipe-down dismiss on the shared frame.
assert.match(frame, /useSwipeDismiss<HTMLElement>\(\(\) => close\(\)/, "swipe ends in the same close() the X uses");
assert.equal((frame.match(/useSheetA11y</g) ?? []).length, 1, "one close path: a single useSheetA11y");
assert.doesNotMatch(frame, /onClose\(\)[\s\S]{0,40}swipe|swipe[\s\S]{0,60}onCloseRef/, "swipe never calls onClose directly");
assert.match(frame, /!dismissDisabled && sheetSwipeAllowed/, "dismissDisabled switches the gesture off");
assert.match(frame, /axis: "y", sign: 1/);
assert.match(frame, /data-sheet-handle[^>]*lg:hidden|lg:hidden[^>]*data-sheet-handle/, "grab bar is phones only");
assert.match(frame, /headerRef[\s\S]*touch-none/, "header does not pan the page");
assert.match(frame, /addEventListener\("touchmove", block, \{ passive: false \}\)/, "native pan cancelled while dragging");

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
assert.match(normal, /bg-emerald-600 text-white border-emerald-600/, "Legacy editor appearance remains available for old fixtures");
const proposed = renderToStaticMarkup(React.createElement(GoalHarness, { data: goal, pinned: true, appearance: "sheet" }));
assert.match(proposed, /border-indigo-500 bg-indigo-50/);
assert.match(proposed, /font-mono tabular-nums/);
assert.match(goals, /appearance = "legacy"/);
assert.match(goals, /operations = api/);
assert.match(goals, /const before = new Set/);
assert.match(goals, /res.accounts.find\(a => !before.has\(a.account_id\)\)/);
assert.match(goals, /const accounts = data\?\.accounts \?\? \[\]/, "Account refreshes remain prop-driven");
assert.match(goals, /await operations.saveSavingsGoal\(body\);\s+onSaved\(\);\s+close\(\);/);
assert.match(goals, /editor.footer\(close, true\)/, "Production Save uses the pinned, history-safe footer");
assert.match(goals, /savingManual/);
assert.match(goals, /maxLength=\{60\}/);
assert.match(goals, /<SheetFrame/, "Approved goal sheet renders the production frame");

const initial = { categories: ["Bills"], merchant: "Example shop", from: "2026-09-01", to: "2026-09-30", txnType: "debit" };
const filterHtml = renderToStaticMarkup(React.createElement(TransactionFilterSheetContent, {
  initial, categories: ["Bills", "Groceries"], onApply: noop, onClearAll: noop,
  formId: "test-filter", showActions: false, includeIntroduction: false,
}));
assert.match(filterHtml, /<form id="test-filter"/);
assert.match(filterHtml, /value="Example shop"/);
// G136: the dates render through DateField (no native input), formatted British.
assert.match(filterHtml, /aria-label="From, 1 Sep 2026"/);
assert.match(filterHtml, /aria-label="To, 30 Sep 2026"/);
assert.doesNotMatch(filterHtml, /type="date"/);
assert.match(filterHtml, /aria-pressed="true"[^>]*>Money out/);
assert.match(filterHtml, /aria-pressed="true"[^>]*>Bills/);
assert.doesNotMatch(filterHtml, /Show results/);
assert.match(filters, /onSubmit=\{submit\}/, "The pinned external form button submits the actual draft");
assert.match(filters, /<SheetFrame/, "Approved filter sheet renders the production frame");
assert.match(filters, /onApply=\{draft => closeThen\(\(\) => onApply\(draft\)\)\}/);
assert.match(preview, /<SavingsGoalSheet/);
assert.match(preview, /<TransactionFilterSheet/);
assert.doesNotMatch(preview, /\bapi\.|\bfetch\(/);
assert.doesNotMatch(preview, /useSavingsGoalEditor|TransactionFilterSheetContent/, "Preview cannot rebuild the production sheet wrappers");
assert.match(preview, /FixtureBottomNav/);
// Every customer bottom sheet found in the migration inventory uses the
// same shell. Penny, private ops dialogs and centred confirmations are separate.
for (const file of ["AimSheet", "BankPickerSheet", "CardTermsSheet", "CategorisationRulesSheet", "CategorySheet", "CommitmentSheet", "InsightCard", "IntentConsentSheet", "InvestmentUpload", "MiscategorisedReviewSheet", "MoreMessagesSheet", "PayPeriodSettingsSheet", "PlanOneOffSheet", "SetAsideSheet", "SpendHeader", "SpendTrends", "StatementUpload", "TeachingSheet", "TransactionSheet", "UpcomingFlowSheet", "YourPlanCard", "upcoming/UpcomingDetailsSheet"]) {
  const component = source(`../components/${file}.tsx`);
  assert.match(component, /<SheetFrame/, `${file} uses the shared anatomy`);
  assert.doesNotMatch(component, /className=[^\n]*glass-sheet/, `${file} cannot retain a competing legacy shell`);
}
for (const file of ["../app/components/AccountsPage.tsx", "../app/spend/shape/MoneyShapeHero.tsx"]) {
  assert.match(source(file), /<SheetFrame/);
  assert.doesNotMatch(source(file), /className=[^\n]*glass-sheet/);
}
const a11y = source("../lib/useSheetA11y.ts");
assert.match(a11y, /focusStack.at\(-1\) !== el/);
assert.match(a11y, /event.state\?\.__sheetA11yId === id/);
assert.match(a11y, /scrollLockCount/);
assert.match(a11y, /if \(!liveElement.current\) return/);
assert.match(flow, /const hasFooter = rendered\.footer != null \|\| portalFooters > 0/);
assert.match(flow, /footer=\{hasFooter \?/);
assert.match(flow, /!hasFooter && <div ref=\{fallbackFooterRef\}/, "Footerless flow views retain a portal host without a pinned empty footer");
assert.match(flow, /useEffect\(retain, \[retain\]\)/, "Embedded action portals retain the pinned footer when present");
assert.doesNotMatch(category, /<h2 className="text-base font-bold/, "SheetFrame owns the only sheet heading");
assert.match(commitment, /onClose=\{handleSheetClose\}/);
assert.match(commitment, /onEscape=\{showConsent \? returnToDraft : undefined\}/);
assert.match(commitment, /onBack=\{showConsent \? returnToDraft : undefined\}/);
assert.match(commitment, /key=\{sheetHistoryGeneration\}/, "Consent Back restores the SheetFrame history entry with the draft intact");
assert.match(commitment, /allowConsentCloseRef\.current = true/, "A consent save or route handoff still closes the entire sheet");
assert.match(insight, /setDone\(true\);\s+\/\/ The write has completed[\s\S]*setSaving\(false\);/, "Saved insight confirmation can be dismissed after the request finishes");
assert.match(setAside, /if \(kind === "date"\) \{ closeThen\(\(\) => onSelectByDate\?\.\(\)\); return; \}/);
assert.match(accountsPage, /useAccountDetailHistory\(setSelectedAccountId, clearSelectedTransaction\);/);
assert.match(accountHistoryHook, /attachAccountPopListener\(window, \(\) => handlers\.current, openSheetHistoryCount\)/, "Account detail popstate asks whether a sheet owns the traversal");
assert.match(source("../lib/accountSheetHistory.ts"), /addEventListener\("popstate", onPop, true\)/, "Capture phase reads the sheet stack before sheets pop themselves");
assert.match(a11y, /export function openSheetHistoryCount\(\): number \{\s*return openSheetCount\(sheetHistoryStack\.length\);/, "Production open-sheet count includes pending teardown pops");
assert.match(a11y, /beginTeardownPop\(\);\s*history\.back\(\)/, "Parent-unmount teardown pops are counted as an open sheet until delivered");
assert.match(accountHistoryHook, /\[\],\s*\);\s*\}\s*$/, "Listener registers once; re-registering mid-dispatch makes the browser skip it");
assert.doesNotMatch(accountsPage, /addEventListener\("popstate"/, "No raw popstate listener may clear account detail");
assert.match(contractExamples, /useAccountDetailHistory\(setAccountId, \(\) => setEditorOpen\(false\)\);/, "The auth-free fixture exercises the real Accounts popstate hook");
assert.match(contractExamples, /<SheetFrame title="Account editor"/, "The account fixture uses a real nested production sheet");
assert.match(contractExamples, /title: "Footerless details", body:/);
assert.match(contractExamples, /title: "Editor with footer actions", body: <LocalEditor/, "The fixture exercises footerless → portalled editor → footerless flow");
assert.match(commitment, /allowConsentCloseRef\.current = false;[\s\S]*setSaveError\(true\);/, "A failed consent save restores one-step dismissal");
assert.match(commitment, /operations = api/);
assert.match(commitment, /operations\.previewCommitment/);
assert.match(commitment, /operations\.createCommitment/);
assert.match(commitment, /operations\.updateCommitment/);
assert.match(commitment, /operations\.cancelCommitment/);
assert.match(contractExamples, /<CommitmentSheet accounts=\{\[FIXTURE_ACCOUNT\]\}/, "The auth-free consent fixture renders the real CommitmentSheet");
assert.match(contractExamples, /if \(attempts\.current === 1\) throw new Error\("Fixture first-save failure"\);/, "Consent fixture fails exactly once before a successful save");
assert.match(contractExamples, /anyway: "Save despite card plan"/);
assert.match(frame, /\[&_button:not\(\[data-compact\]\)\]:min-h-11/, "Sheet buttons get 44px targets unless a control opts out with data-compact");
assert.match(source("../app/globals.css"), /\[data-sheet-frame\] \{\s+animation: slideUp/, "SheetFrame keeps the phone slide-up entrance");
console.log("G192 SSR, real forms, approved production parity and complete sheet inventory passed");
