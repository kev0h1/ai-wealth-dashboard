import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveUpcomingPeriod } from "../lib/upcomingPeriod.ts";
import { paymentsThroughLabel, upcomingAccountWindow } from "../lib/upcomingAccounts.ts";
import UpcomingHeroCard from "../components/upcoming/UpcomingHeroCard.tsx";

// G327: Upcoming reads its pay period from the cashflow payload. A last-Friday
// server period (25 Sep to 29 Oct, payday Fri 30 Oct, today 24 Oct = day 30 of 35)
// must win over a calendar-month client seed.
const calendarSeed = { config: { type: "calendar_month" }, nowMs: Date.parse("2026-10-24T10:00:00Z") };
const period = { start: "2026-09-25", end: "2026-10-29", length_days: 35, day_number: 30, payday: "2026-10-30", label: "25 Sep to 29 Oct", payday_observed: null, type: "last_friday" };

const seeded = resolveUpcomingPeriod(null, calendarSeed);
assert.equal(seeded.fromServer, false);
assert.equal(seeded.end.toISOString().slice(0, 10), "2026-10-31", "the seed is the calendar month before the payload arrives");

const p = resolveUpcomingPeriod({ period }, calendarSeed);
assert.equal(p.fromServer, true);
assert.equal(p.start.toISOString().slice(0, 10), "2026-09-25");
assert.equal(p.end.toISOString().slice(0, 10), "2026-10-29");
assert.equal(p.payday.toISOString().slice(0, 10), "2026-10-30");
assert.equal(p.daysToPayday, 6, "days to payday = length_days - day_number + 1, from the payload");
assert.equal(p.paydayLabel, "Fri 30 Oct");
assert.equal(p.isCalendarMonth, false, "month-end wording follows the server's config type, not the client seed");

// Nothing in the resolved period can come from the calendar-month seed.
for (const forbidden of ["2026-10-31", "2026-11-01"]) {
  for (const d of [p.start, p.end, p.payday]) assert.notEqual(d.toISOString().slice(0, 10), forbidden);
}

// Different seeds, same payload: identical result.
const other = resolveUpcomingPeriod({ period }, { config: { type: "last_friday" }, nowMs: Date.parse("2026-01-02T00:00:00Z") });
assert.deepEqual({ ...other, fromServer: 1 }, { ...p, fromServer: 1 });

// "Payments through" comes from the payload's period end, via the shared window.
const endMs = p.end.getTime();
const through = paymentsThroughLabel(upcomingAccountWindow(endMs, Date.parse("2026-10-24T10:00:00Z")));
assert.equal(through, "Payments through Thu 29 Oct");
assert.equal(paymentsThroughLabel(upcomingAccountWindow(endMs, Date.parse("2026-10-29T10:00:00Z"))), "Payments through Wed 4 Nov", "final-day lookahead uses the server payday");

// A confirmed salary date never replaces the period's own payday.
const observed = resolveUpcomingPeriod({ period: { ...period, payday_observed: { date: "2026-10-28", source: "confirmed" } } }, calendarSeed);
assert.equal(observed.paydayLabel, "Fri 30 Oct");

// The hero renders the payload-derived figures.
const hero = renderToStaticMarkup(React.createElement(UpcomingHeroCard, {
  isCalendarMonth: p.isCalendarMonth, daysToPayday: p.daysToPayday, paydayLabel: p.paydayLabel, spendableNow: 500,
  runwayIncomeTotal: 0, runwayBillsTotal: 100, allocationsRemainingTotal: 0, savingsNow: 0, runway: 400, runwayStatus: "left",
}));
assert.match(hero, /Fri 30 Oct · 6 days/);
assert.match(hero, /Projected at payday/);
assert.doesNotMatch(hero, /31 Oct|month end/);

// Calendar-month server period keeps month-end wording.
const cal = resolveUpcomingPeriod({ period: { start: "2026-10-01", end: "2026-10-31", length_days: 31, day_number: 24, payday: "2026-11-01", label: "1 Oct to 31 Oct", payday_observed: null, type: "calendar_month" } }, { config: { type: "last_friday" }, nowMs: calendarSeed.nowMs });
assert.equal(cal.isCalendarMonth, true);
assert.equal(cal.daysToPayday, 8);
// Final day under both clocks: 00:30 BST on 29 Oct is still 28 Oct in UTC. The
// server says day 35 of 35 (1 day to payday), so the window must extend, as the hero does.
const lateNow = Date.parse("2026-10-28T23:30:00Z");
const finalDay = resolveUpcomingPeriod({ period: { ...period, day_number: 35 } }, { config: { type: "calendar_month" }, nowMs: lateNow });
assert.equal(finalDay.daysToPayday, 1);
assert.equal(upcomingAccountWindow(finalDay.end.getTime(), lateNow), Date.parse("2026-10-29") + 86400000 - 1, "legacy UTC test disagrees in that hour");
assert.equal(upcomingAccountWindow(finalDay.end.getTime(), lateNow, finalDay.daysToPayday), Date.parse("2026-11-04"), "server day drives the final-day lookahead");
const earlyNow = Date.parse("2026-10-29T10:00:00Z");
assert.equal(upcomingAccountWindow(finalDay.end.getTime(), earlyNow, finalDay.daysToPayday), upcomingAccountWindow(finalDay.end.getTime(), earlyNow), "clocks agree when UTC and London share the day");
console.log("g327-upcoming-period ok");
