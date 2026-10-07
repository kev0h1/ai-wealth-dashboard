// Run: npm run -s check:date-picker
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DatePickerSheet } from "../components/DatePicker/DatePickerSheet.tsx";
import { DateField } from "../components/DatePicker/DateField.tsx";

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const sheet = src("../components/DatePicker/DatePickerSheet.tsx");
const noop = () => {};

// Late mount: the frame must not exist on the first render, so it always
// appends to <body> after its host's portal (see the comment in the sheet).
assert.equal(renderToStaticMarkup(React.createElement(DatePickerSheet, { mode: "day", value: "2026-10-16", onCommit: noop, onClose: noop })), "", "first render emits no portal frame");
assert.match(sheet, /const \[layered, setLayered\] = useState\(false\);\s*const \[nested, setNested\][^\n]*\n\s*useEffect\(\(\) => \{[^}]*setLayered\(true\)/, "frame mounts one commit late");
assert.match(sheet, /if \(!layered\) return null;/);
assert.match(sheet, /Portals append to <body> in commit order/, "late mount keeps its explanation");

// Commit path goes through the pure helper, never an ad hoc format.
assert.match(sheet, /onCommit\(commitValue\(mode, draft\.y, draft\.m, draft\.d\)\)/);
assert.doesNotMatch(sheet, /onCommit\(formatIso/);

// Stacked scrim: nested frames drop only the dim.
assert.match(sheet, /nested=\{nested\}/);
assert.match(sheet, /querySelector\("\[data-sheet-overlay\]"\)/);

// Clear is opt-in and commits an empty value.
assert.match(sheet, /allowClear && <button[^>]*onClick=\{\(\) => \{ onCommit\(""\); controls\.close\(\); \}\}/);

// DateField renders the trigger on the server with the honest empty name.
const field = renderToStaticMarkup(React.createElement(DateField, { mode: "day", value: "", onChange: noop, label: "Date", emptyDescription: "not set, defaults to today" }));
assert.match(field, /aria-label="Date, not set, defaults to today"/);
assert.match(field, /aria-haspopup="dialog"/);
const filled = renderToStaticMarkup(React.createElement(DateField, { mode: "month", value: "2027-03", onChange: noop, label: "By when" }));
assert.match(filled, /aria-label="By when, March 2027"/);
console.log("date-picker: ok");
