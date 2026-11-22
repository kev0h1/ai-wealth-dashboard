import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveHomeChartWindow, periodsLeftFrom, pickServerPeriod } from "../lib/serverPeriodWindow.ts";

// G329: a calendar-month client seed must never leak into rendered period dates
// once a server period exists. Server period: last Friday, 25 Sep to 29 Oct.
const calendar = { type: "calendar_month" };
const now = new Date("2026-10-24T10:00:00Z");
const iso = (d) => d.toISOString().slice(0, 10);
const period = { start: "2026-09-25", end: "2026-10-29", length_days: 35, day_number: 30, payday: "2026-10-30", label: "25 Sep to 29 Oct", payday_observed: null, type: "last_friday" };

// Home pinned chart window.
const fb = resolveHomeChartWindow({ fallback: { config: calendar, now } });
assert.equal(fb.source, "client-fallback");
assert.equal(iso(fb.end), "2026-10-31", "fallback is the calendar month, clearly marked");
const fromSts = resolveHomeChartWindow({ safeToSpendPeriod: period, verdictPeriod: { start: "2026-01-01", end: "2026-01-31" }, fallback: { config: calendar, now } });
assert.equal(fromSts.source, "safe-to-spend");
assert.equal(iso(fromSts.start), "2026-09-25");
assert.equal(iso(fromSts.end), "2026-10-29");
const fromVerdict = resolveHomeChartWindow({ verdictPeriod: { start: "2026-09-25", end: "2026-10-29" }, fallback: { config: calendar, now } });
assert.equal(fromVerdict.source, "verdict");
assert.equal(iso(fromVerdict.end), "2026-10-29");
for (const w of [fromSts, fromVerdict]) for (const d of [w.start, w.end]) assert.ok(!["2026-10-01", "2026-10-31"].includes(iso(d)), "no calendar-month bound leaks");

// A payload cached across a rollover (period already ended) is skipped.
const staleSts = { start: "2026-09-25", end: "2026-10-23" };
const skipToVerdict = resolveHomeChartWindow({ safeToSpendPeriod: staleSts, verdictPeriod: { start: "2026-10-24", end: "2026-11-27" }, fallback: { config: calendar, now } });
assert.equal(skipToVerdict.source, "verdict", "stale Safe to Spend period falls through to the verdict");
assert.equal(iso(skipToVerdict.end), "2026-11-27");
const skipToFallback = resolveHomeChartWindow({ safeToSpendPeriod: staleSts, verdictPeriod: staleSts, fallback: { config: calendar, now } });
assert.equal(skipToFallback.source, "client-fallback");
assert.equal(resolveHomeChartWindow({ safeToSpendPeriod: { start: "2026-10-01", end: "2026-10-24" }, fallback: { config: calendar, now } }).source, "safe-to-spend", "a period ending today is still current");

// CommitmentSheet periods-left: the server anchor wins over the seed config's current period.
const anchor = pickServerPeriod(period);
assert.equal(iso(anchor.end), "2026-10-29");
const serverLeft = periodsLeftFrom("2026-12", { type: "last_friday" }, anchor, now);
const seedLeft = periodsLeftFrom("2026-12", { type: "last_friday" }, null, now);
assert.equal(serverLeft, seedLeft, "last_friday config agrees with its own server anchor");
const monthlyAnchored = periodsLeftFrom("2026-12", calendar, pickServerPeriod({ start: "2026-10-01", end: "2026-10-31" }), now);
assert.equal(monthlyAnchored, 2, "Nov 1 and Dec 1 period starts");
// Source wiring: the sites read the server period.
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const home = read("../app/components/HomePage.tsx");
assert.match(home, /resolveHomeChartWindow\(/);
assert.doesNotMatch(home, /getPayPeriodWithConfig/, "Home no longer derives its window from the client config");
const sheet = read("../components/CommitmentSheet.tsx");
assert.match(sheet, /pickServerPeriod\(serverPeriod, cachedVerdict\(0\)\?\.period, fetchedPeriod\)/);
assert.doesNotMatch(sheet, /getPayPeriodWithConfig|nextPeriodWithConfig/);
assert.match(read("../app/planning/PlanningPage.tsx"), /serverPeriod=\{cashflow\?\.period\}/);
const spend = read("../app/components/SpendPage.tsx");
assert.match(spend, /new Date\(dateToUTCDay\(serverPeriod\.start\)\)/, "SpendTrends bounds come from verdict.period");

// Redirect and CommitmentSheet fetch fallbacks.
assert.match(spend, /currentServer\.start/, "category redirect prefers the verdict period");
assert.match(sheet, /fetchVerdictData\(0\)/, "sheet fetches the verdict once when no host period exists");
assert.match(sheet, /pickServerPeriod\(serverPeriod, cachedVerdict\(0\)\?\.period, fetchedPeriod\)/);

console.log("g329 client period leftovers: ok");
