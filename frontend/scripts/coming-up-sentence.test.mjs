// G208: the Home "Coming up" DropSentence, one check per branch against the
// Kevin-approved wording (2026-10-04). Renders the REAL production component.
//   npm run -s check:coming-up-sentence
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DropSentence, computeDrop } from "../lib/comingUp.tsx";

function bill(amount, daysAway, date, name = "Bill") {
  return { name, amount, daysAway, date, kind: "commitment" };
}
function text(bills) {
  const html = renderToStaticMarkup(React.createElement("p", null, React.createElement(DropSentence, { bills })));
  return html.replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'");
}
let failures = 0;
function check(label, bills, kind, expected) {
  const got = text(bills);
  const d = computeDrop(bills);
  const gotKind = d.kind + (d.sameDay ? ":sameDay" : "") + (d.singleDay ? ":singleDay" : "");
  if (got !== expected || gotKind !== kind) {
    failures += 1;
    console.error(`FAIL: ${label}\n  kind ${gotKind} (want ${kind})\n  got      ${JSON.stringify(got)}\n  expected ${JSON.stringify(expected)}`);
  } else console.log(`PASS: ${label}`);
  assert.ok(!/[—–]/.test(got), "no dashes");
  assert.ok(!/\d(st|nd|rd|th)\b/.test(got), "no ordinals");
  assert.ok(!/heaviest|lands|\bdue\b/.test(got) || kind === "empty", `no old wording: ${got}`);
}

check("empty (unchanged)", [], "empty", "Nothing due in the next 14 days.");

// Kevin's case: 4 payments tomorrow = £169 of £194, nothing else on that day.
check("concentrated sameDay, through equals day total (Kevin's case)", [
  bill(100, 1, "Mon 5 Oct"), bill(40, 1, "Mon 5 Oct"), bill(20, 1, "Mon 5 Oct"), bill(9, 1, "Mon 5 Oct"),
  bill(25, 9, "Wed 14 Oct"),
], "concentrated:sameDay", "£169 of this fortnight's £194 is expected tomorrow, Mon 5 Oct, across 4 payments.");

check("concentrated singleDay (today)", [
  bill(120, 0, "Sun 4 Oct"), bill(30, 0, "Sun 4 Oct"), bill(10, 9, "Tue 13 Oct"),
], "concentrated:sameDay:singleDay", "£150 of this fortnight's £160 is expected today, across 2 payments.");

// sameDay but through-amount differs from the day total: earlier small bill.
check("concentrated sameDay, through differs from day total", [
  bill(20, 1, "Mon 5 Oct"), bill(150, 3, "Wed 7 Oct"), bill(30, 3, "Wed 7 Oct"), bill(10, 12, "Mon 12 Oct"),
], "concentrated:sameDay", "£200 of this fortnight's £210 is expected by Wed 7 Oct, including £180 across 2 payments that day.");

check("concentrated general (crossing day differs from busiest day)", [
  bill(60, 1, "Mon 5 Oct"), bill(50, 2, "Tue 6 Oct"), bill(70, 4, "Thu 8 Oct"),
], "concentrated", "£110 of this fortnight's £180 is expected by Tue 6 Oct. The busiest day is tomorrow, Mon 5 Oct: £60 across 1 payment.");

check("landing sameDay", [
  bill(40, 0, "Sun 4 Oct"), bill(30, 7, "Sun 11 Oct"), bill(30, 8, "Mon 12 Oct"), bill(30, 9, "Tue 13 Oct"),
], "landing:sameDay", "£40 is expected today, Sun 4 Oct, across 1 payment, the busiest day of this fortnight's £130.");

check("landing general", [
  bill(15, 0, "Sun 4 Oct"), bill(30, 4, "Thu 8 Oct"), bill(25, 8, "Mon 12 Oct"), bill(25, 9, "Tue 13 Oct"), bill(25, 10, "Wed 14 Oct"),
], "landing", "£15 is expected today, Sun 4 Oct. The busiest day is Thu 8 Oct: £30 across 1 payment, out of £120 this fortnight.");

check("landing tomorrow keeps the date", [
  bill(40, 1, "Mon 5 Oct"), bill(30, 7, "Sun 11 Oct"), bill(30, 8, "Mon 12 Oct"), bill(30, 9, "Tue 13 Oct"),
], "landing:sameDay", "£40 is expected tomorrow, Mon 5 Oct, across 1 payment, the busiest day of this fortnight's £130.");

check("calm", [
  bill(30, 5, "Fri 9 Oct"), bill(20, 9, "Tue 13 Oct"), bill(20, 10, "Wed 14 Oct"),
], "calm", "Nothing is expected for 5 days. Then the busiest day is Fri 9 Oct: £30 across 1 payment, out of £70 this fortnight.");

// Amounts render in mono.
{
  const html = renderToStaticMarkup(React.createElement(DropSentence, { bills: [bill(30, 5, "Fri 9 Oct")] }));
  assert.ok((html.match(/font-mono tabular-nums/g) ?? []).length >= 2, "amounts are mono");
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll coming-up-sentence (G208) checks passed.");
