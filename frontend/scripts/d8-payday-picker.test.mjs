// D8: onboarding and Settings share ONE pay period picker; each option maps to
// the right engine type and fields; onboarding defaults to monthly on a chosen
// date; no native date input.
//   npm run -s check:d8-payday-picker
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DRAFT, configFromDraft, draftFromConfig, isDraftComplete, weekdayOfIso } from "../lib/payPeriodDraft.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(here, "..", p), "utf8");

// Onboarding default: monthly on a set date.
assert.equal(DEFAULT_DRAFT.mode, "monthly_pay_date");
assert.deepEqual(configFromDraft(DEFAULT_DRAFT), { type: "monthly_pay_date", day: 25 });

// Each option maps to the engine type and fields (backend/app/services/pay_period.py).
assert.deepEqual(configFromDraft({ ...DEFAULT_DRAFT, mode: "monthly_pay_date", day: 3 }), { type: "monthly_pay_date", day: 3 });
assert.deepEqual(configFromDraft({ ...DEFAULT_DRAFT, mode: "last_day" }), { type: "monthly_pay_date", day: 31 }, "last day = pay day clamped to month end, never calendar_month");
assert.deepEqual(configFromDraft({ ...DEFAULT_DRAFT, mode: "last_weekday_of_month", weekday: 3 }), { type: "last_weekday_of_month", weekday: 3 });
assert.deepEqual(configFromDraft({ ...DEFAULT_DRAFT, mode: "calendar_month" }), { type: "calendar_month" });
// 2026-10-09 is a Friday (5): the weekday is derived from the chosen payday.
assert.equal(weekdayOfIso("2026-10-09"), 5);
assert.deepEqual(configFromDraft({ ...DEFAULT_DRAFT, mode: "biweekly", referenceDate: "2026-10-09" }), { type: "biweekly", weekday: 5, referenceDate: "2026-10-09" });
// Biweekly cannot be saved until a payday is chosen.
assert.equal(configFromDraft({ ...DEFAULT_DRAFT, mode: "biweekly" }), null);
assert.equal(isDraftComplete({ ...DEFAULT_DRAFT, mode: "biweekly" }), false);
assert.equal(isDraftComplete(DEFAULT_DRAFT), true);

// Settings opens on what is saved.
for (const c of [
  { type: "monthly_pay_date", day: 15 },
  { type: "monthly_pay_date", day: 31 },
  { type: "last_weekday_of_month", weekday: 4 },
  { type: "biweekly", weekday: 5, referenceDate: "2026-10-09" },
  { type: "calendar_month" },
]) assert.deepEqual(configFromDraft(draftFromConfig(c)), c, JSON.stringify(c));
assert.equal(draftFromConfig({ type: "monthly_pay_date", day: 31 }).mode, "last_day");
assert.deepEqual(configFromDraft(draftFromConfig({ type: "last_friday" })), { type: "last_weekday_of_month", weekday: 5 });

// One picker, used by both surfaces, no copy.
const picker = read("components/PayPeriodPicker.tsx");
const onboarding = read("components/Onboarding.tsx");
const settings = read("components/PayPeriodSettingsSheet.tsx");
assert.match(onboarding, /<PayPeriodPicker\b/);
assert.match(settings, /<PayPeriodPicker\b/);
assert.match(onboarding, /useState<PayPeriodDraft>\(DEFAULT_DRAFT\)/, "onboarding starts on the monthly default");
for (const [name, src] of [["Onboarding", onboarding], ["PayPeriodSettingsSheet", settings]]) {
  assert.ok(!/PAY_OPTIONS/.test(src), `${name}: canned presets are gone`);
  assert.ok(!/CustomSelect|DateField/.test(src), `${name}: picker controls live only in PayPeriodPicker`);
  assert.ok(!/last_weekday_of_month|biweekly|monthly_pay_date/.test(src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")), `${name}: no second mapping to engine types`);
}
assert.match(picker, /DateField/);
assert.ok(!/type\s*=\s*["'](date|month|datetime-local)["']/.test(picker), "no native date input");
assert.match(picker, /Last day of the month/);
assert.match(picker, /Last Monday to Friday of the month/);
assert.match(picker, /Every two weeks/);
assert.ok(!/—/.test(picker + read("lib/payPeriodDraft.ts")), "no em dashes");
assert.ok(!/!/.test(picker.match(/label: "[^"]*"|desc: "[^"]*"/g).join(" ")), "no exclamation marks in copy");
console.log("ok  d8-payday-picker");
