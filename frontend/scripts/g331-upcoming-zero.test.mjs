import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import UpcomingHeroCard from "../components/upcoming/UpcomingHeroCard.tsx";
import { buildUpcomingRunwayView, formatUpcomingRunwayAmount } from "../lib/pennyScreenViews.ts";
import { forecastPence, upcomingForecastPresentation } from "../lib/cashForecastStatus.ts";

const baseProps = {
  isCalendarMonth: false,
  daysToPayday: 3,
  paydayLabel: "Fri 30 Oct",
  spendableNow: 100,
  runwayIncomeTotal: 0,
  runwayBillsTotal: 0,
  allocationsRemainingTotal: 0,
  savingsNow: 0,
};
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

for (const [runway, status, visual] of [
  [0, "even", "£0"],
  [0.01, "left", "£0.01"],
  [0.42, "left", "£0.42"],
  [0.99, "left", "£0.99"],
  [-0.01, "short", "−£0.01"],
  [-0.42, "short", "−£0.42"],
  [-0.99, "short", "−£0.99"],
]) {
  const html = renderToStaticMarkup(React.createElement(UpcomingHeroCard, {
    ...baseProps,
    runway,
    runwayBillsTotal: baseProps.spendableNow - runway,
    runwayStatus: status,
  }));
  assert.match(html, new RegExp(escapeRegex(visual)), `${runway}: SSR preserves the visible runway`);
  assert.match(html, new RegExp(`aria-label="${visual.replace("−", "").replace("£", "")} pounds ${status}"`), `${runway}: screen reader receives the same precision`);
  const working = html.slice(html.indexOf("<dl"), html.indexOf("</dl>") + 5);
  const exactTotal = `${runway < 0 ? "−" : ""}£${Math.abs(runway).toFixed(2)}`;
  assert.ok(working.includes(exactTotal), `${runway}: disclosed total retains exact pennies`);
  assert.ok(working.includes(`£${(baseProps.spendableNow - runway).toFixed(2)}`), `${runway}: disclosed bills retain exact pennies`);
  if(runway < 0) assert.doesNotMatch(working, /−£0(?![.\d])/, "no rounded-zero shortfall remains in working");
  const penny = buildUpcomingRunwayView({ runway, runwayStatus: status, isCalendarMonth: false });
  assert.equal(penny.figures[0].value, visual, `${runway}: Penny matches the hero`);
}

assert.equal(formatUpcomingRunwayAmount(1), "£1", "whole-pound style resumes at £1");
assert.equal(formatUpcomingRunwayAmount(1.42), "£1", "amounts above £1 retain the established whole-pound reading");

const floatingZero = forecastPence(0.3 - 0.1 - 0.2);
assert.equal(floatingZero, 0, "penny arithmetic residue is exactly covered before presentation");
const floatingZeroStatus = floatingZero < 0 ? "short" : floatingZero > 0 ? "left" : "even";
assert.equal(floatingZeroStatus, "even", "normalised arithmetic reaches Upcoming's even state");
assert.equal(buildUpcomingRunwayView({ runway: floatingZero, runwayStatus: floatingZeroStatus, isCalendarMonth: false }).figures[0].value, "£0", "Penny receives the normalised even runway");
assert.equal(forecastPence(-0.01), -0.01, "a genuine penny shortage remains a shortage");
const zeroEvidence = upcomingForecastPresentation({
  runway: floatingZero,
  lowestCash: forecastPence(0.3 - 0.1 - 0.2),
  evidenceCurrent: true,
  nextPayday: Date.parse("2026-10-30"),
  isCalendarMonth: false,
  metadata: null,
  headline: null,
  plansAvailable: true,
});
assert.notEqual(zeroEvidence.status.tone, "risk", "zero-valued dated evidence does not create an earlier payment gap");

const masked = renderToStaticMarkup(React.createElement(UpcomingHeroCard, {
  ...baseProps,
  runway: -0.42,
  runwayStatus: "short",
  balancesHidden: true,
}));
assert.match(masked, /−£••••/, "masked short runway keeps its sign without leaking pence");
assert.match(masked, /aria-label="Amount hidden, short"/, "masked runway stays hidden from assistive technology");
assert.doesNotMatch(masked, /0\.42/, "masked runway does not leak its value");

console.log("PASS G331: Upcoming preserves sub-pound runway amounts in SSR, assistive text and Penny context.");
