// Run: npm run -s check:calendar
import assert from "node:assert/strict";
import {
  addDays, addMonths, chunk, clampIso, daysIn, formatDay, formatIso, formatMonth, formatValue, monthGridCells,
  outOfRange, parseIso, todayIso, weekdayName, yearPage, yearPageStart,
} from "../lib/calendar.ts";

// ISO parse and format round-trip, both modes.
assert.deepEqual(parseIso("2026-10-16", "day"), { y: 2026, m: 9, d: 16 });
assert.deepEqual(parseIso("2027-03", "month"), { y: 2027, m: 2, d: 1 });
assert.equal(parseIso("2026-02-30", "day"), null);
assert.equal(parseIso("2026-13", "month"), null);
assert.equal(parseIso("", "day"), null);
assert.equal(parseIso("2026-10", "day"), null);
assert.equal(parseIso("2026-10-16", "month"), null);
assert.equal(formatIso({ y: 2026, m: 0, d: 5 }, "day"), "2026-01-05");
assert.equal(formatIso({ y: 2026, m: 11, d: 5 }, "month"), "2026-12");

// British display.
assert.equal(formatDay({ y: 2026, m: 9, d: 16 }), "16 Oct 2026");
assert.equal(formatMonth({ y: 2026, m: 8, d: 1 }), "September 2026");
assert.equal(formatValue("2026-10-05", "day"), "5 Oct 2026");
assert.equal(formatValue("2027-03", "month"), "March 2027");
assert.equal(formatValue("nonsense", "day"), "");
assert.equal(weekdayName({ y: 2026, m: 9, d: 5 }), "Monday");
assert.equal(todayIso(new Date(2026, 9, 5, 23, 59)), "2026-10-05");

// Month grid: Monday-first, blanks either side, multiple of 7.
const oct = monthGridCells(2026, 9); // 1 Oct 2026 is a Thursday
assert.equal(oct.length % 7, 0);
assert.deepEqual(oct.slice(0, 5), [null, null, null, 1, 2]);
assert.equal(oct.filter((c) => c !== null).length, 31);
assert.equal(oct.at(-1), null);
const feb = monthGridCells(2026, 1); // 1 Feb 2026 is a Sunday: six leading blanks
assert.equal(feb.indexOf(1), 6);
assert.equal(feb.filter((c) => c !== null).length, 28);
assert.equal(daysIn(2028, 1), 29);
assert.equal(chunk(oct, 7).length, oct.length / 7);

// Arithmetic crossing month and year ends.
assert.deepEqual(addDays({ y: 2026, m: 11, d: 31 }, 1), { y: 2027, m: 0, d: 1 });
assert.deepEqual(addMonths({ y: 2026, m: 0, d: 31 }, 1), { y: 2026, m: 1, d: 28 });
assert.deepEqual(addMonths({ y: 2026, m: 0, d: 15 }, -1), { y: 2025, m: 11, d: 15 });

// Clamp and range.
assert.equal(clampIso("2026-09-01", "day", "2026-10-05"), "2026-10-05");
assert.equal(clampIso("2026-12-01", "day", "2026-10-05", "2026-11-30"), "2026-11-30");
assert.equal(clampIso("2026-10-16", "day", "2026-10-05"), "2026-10-16");
assert.equal(clampIso("2026-01", "month", "2026-10"), "2026-10");
assert.equal(clampIso("bad", "day"), "");
assert.equal(outOfRange({ y: 2026, m: 9, d: 4 }, "day", { y: 2026, m: 9, d: 5 }, null), true);
assert.equal(outOfRange({ y: 2026, m: 9, d: 5 }, "day", { y: 2026, m: 9, d: 5 }, null), false);
assert.equal(outOfRange({ y: 2026, m: 9, d: 20 }, "month", { y: 2026, m: 9, d: 5 }, null), false);

// Year pages: aligned to min when there is one, bounded either side.
assert.equal(yearPageStart(2026, 2026), 2026);
assert.equal(yearPageStart(2040, 2026), 2038);
assert.equal(yearPageStart(2026), 2022);
const first = yearPage(2026, 2026);
assert.equal(first.years.length, 12);
assert.equal(first.years[0], 2026);
assert.equal(first.hasPrev, false);
assert.equal(first.hasNext, true);
assert.equal(yearPage(2026, 2026, 2037).hasNext, false);
assert.equal(yearPage(2020, null, null).hasPrev, true);
console.log("calendar: ok");
