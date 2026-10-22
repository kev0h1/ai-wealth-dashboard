// E10: raw props through the Runtime settings block. Each row shows its label,
// key, current value and source chip; booleans get a toggle, numbers and text
// get an input and Save; the two purchase switches carry the confirm step;
// only database-sourced rows offer "use env or default"; no red, no em dash,
// no exclamation mark; and nothing here can render a security key because the
// block only draws the rows it is given.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RuntimeSettings, {
  RUNTIME_SETTINGS_TITLE,
  RUNTIME_SETTINGS_WORDING,
  formatSettingValue,
} from "../app/ops/health/RuntimeSettings.tsx";

const row = (o) => ({ help: "", min: null, max: null, confirm_on: false, default: null, group: "Alerts", ...o });
const rows = [
  row({ key: "ALERTS_ENABLED", label: "Push alerts", type: "bool", value: false, source: "default", default: false }),
  row({ key: "ALERT_HOURLY_CAP", label: "Alert pushes per hour", type: "int", value: 7, source: "database", default: 5, min: 1, max: 100 }),
  row({ key: "LLM_MONTHLY_BUDGET_USD", label: "LLM monthly budget (USD)", type: "float", value: null, source: "default", group: "Cost controls", min: 0.01, max: 1000000 }),
  row({ key: "FINEXER_TEMPLATE_DARK", label: "Finexer dark consent template id", type: "str", value: "", source: "env", group: "Bank connection" }),
  row({ key: "APPLE_IAP_ENABLED", label: "Apple in-app purchase", type: "bool", value: true, source: "database", group: "Purchases", confirm_on: true }),
  row({ key: "PLAY_IAP_ENABLED", label: "Google Play purchase", type: "bool", value: false, source: "env", group: "Purchases", confirm_on: true }),
];
const noop = () => {};
const html = renderToStaticMarkup(h(RuntimeSettings, { rows, onSave: noop, onClear: noop, message: "Saved." }));
const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

assert.equal(RUNTIME_SETTINGS_TITLE, "Runtime settings");
assert.equal((html.match(/data-setting="/g) ?? []).length, rows.length, "one row per setting");
for (const r of rows) {
  assert.ok(html.includes(`data-setting="${r.key}"`), `${r.key} row`);
  assert.ok(text.includes(r.label), `${r.label} label`);
}
assert.match(html, /data-source="database"/);
assert.match(html, /data-source="env"/);
assert.match(html, /data-source="default"/);
assert.match(text, /Alert pushes per hour/);
assert.match(text, /Now: 7/);
assert.match(text, /Now: Not set/, "an unset number reads Not set");
assert.match(text, /Allowed 1 to 100/);
assert.equal(formatSettingValue(rows[3]), "Off", "empty template id reads Off");
assert.equal(formatSettingValue(rows[4]), "On");

// Toggle copy follows the current state.
assert.match(text, new RegExp(RUNTIME_SETTINGS_WORDING.turnOn));
assert.match(text, new RegExp(RUNTIME_SETTINGS_WORDING.turnOff));
// Inputs for number and text rows, with Save.
assert.equal((html.match(/<input /g) ?? []).length, 3);
assert.equal((html.match(new RegExp(`>${RUNTIME_SETTINGS_WORDING.save}<`, "g")) ?? []).length, 3);
// Only the database-sourced rows offer the revert control.
assert.equal((html.match(new RegExp(RUNTIME_SETTINGS_WORDING.useDefault, "g")) ?? []).length, 2);
// 44px targets and the existing glass card, no filled or red styling.
assert.match(html, /min-h-11/);
assert.match(html, /glass-card/);
assert.doesNotMatch(html, /red-|bg-amber|bg-red|bg-emerald/, "no new colours");
assert.match(text, /Saved\./);
// The confirm dialog is closed until a purchase switch is turned on.
assert.doesNotMatch(html, /alertdialog/);

const empty = renderToStaticMarkup(h(RuntimeSettings, { rows: [], onSave: noop, onClear: noop }));
assert.match(empty, new RegExp(RUNTIME_SETTINGS_WORDING.empty));

const strip = (s) => s.replace(/\{!|!==|!=|!\w|\?!|!\)|!\./g, "");
for (const f of ["../app/ops/health/RuntimeSettings.tsx"]) {
  const src = readFileSync(new URL(f, import.meta.url), "utf8");
  assert.ok(!/[—!]/.test(strip(src)), "no em dash or exclamation mark in copy");
}
for (const w of Object.values(RUNTIME_SETTINGS_WORDING)) assert.ok(!/[—!]/.test(w), "wording is clean");

const page = readFileSync(new URL("../app/ops/health/page.tsx", import.meta.url), "utf8");
assert.match(page, /api\.getOpsSettings/);
assert.match(page, /api\.putOpsSetting\(key, value, confirm\)/);
const comp = readFileSync(new URL("../app/ops/health/RuntimeSettings.tsx", import.meta.url), "utf8");
assert.match(comp, /row\.confirm_on \? setConfirming\(true\)/, "confirm_on switches go through the dialog");
assert.match(comp, /onSave\(row\.key, true, true\)/, "confirm sends confirm true");
console.log("e10-runtime-settings: ok");
