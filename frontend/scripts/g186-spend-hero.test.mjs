import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fixture, incomeFor, STATES } from "../app/design/spend-hero/fixtures.ts";

const normal = fixture("normal");
assert.ok(normal);
assert.equal(normal.pills.spent, 3509);
assert.equal(normal.pills.income, 4800);
assert.equal(normal.moved_total, 500);
assert.equal(4010 - normal.pills.spent, 501, "usual pace and default Out reconcile");
assert.equal(normal.notables.reduce((sum, item) => sum + item.excess, 0), 111, "named category difference reconciles");
assert.equal((normal.pills.spent - 4010) - 111, -612, "residual is total minus named difference");
assert.equal(normal.notables.reduce((sum, item) => sum + item.spent, 0) + 2598 + normal.unresolved.total, normal.pills.spent, "Complete spending ledger reconciles to Out");
assert.equal(fixture("unplaced")?.unresolved.total, 125);
const unplaced = fixture("unplaced");
assert.ok(unplaced);
assert.equal(unplaced.notables.reduce((sum, item) => sum + item.spent, 0) + 2598 + unplaced.unresolved.total, unplaced.pills.spent, "Unplaced money remains in Out");
assert.equal(fixture("nobaseline")?.pace_series?.at(-1)?.usual, null, "No baseline cannot invent a pace comparison");
assert.equal(fixture("early")?.pace_series?.at(-1)?.usual, null, "Early period cannot invent a pace comparison");
assert.equal(fixture("empty")?.pace_series?.length, 0, "Empty state has no invented baseline");
assert.equal(fixture("nomoved")?.moved_total, 0);
assert.equal(fixture("loading"), null);
assert.equal(fixture("error"), null);
assert.ok(STATES.length >= 12);

const client = readFileSync(new URL("../app/design/spend-hero/SpendHeroClient.tsx", import.meta.url), "utf8");
assert.match(client, /import \{ SpendJourneySummary \} from "@\/components\/SpendHeader"/);
assert.match(client, /import SpendJourneyNav/);
assert.match(client, /data-production-summary="true"/);
assert.match(client, /data-g186-hero="a"/);
assert.match(client, /data-g186-hero="b"/);
assert.match(client, /data-g186-hero="c"/);
assert.match(client, /Transfers are shown separately/);
assert.match(client, /Usual pace is based on the median of up to three 30-day spending totals for each category before this pay period, adjusted for how far through the period you are\./);
assert.match(client, /Other differences/);
assert.match(client, /Balancing amount/);
assert.match(client, /Difference from usual pace/);
assert.match(client, /There is not enough comparable history for a pace comparison yet/);
assert.match(client, /g186-unplaced/);
assert.match(client, /scroll-mt-24/);
assert.doesNotMatch(client, /api\./, "Preview must not call a live API");
assert.doesNotMatch(client, /<aside\b/, "Auth-exempt previews must not use aside");
for (const { id } of STATES) {
  const value = fixture(id);
  if (!value) continue;
  assert.equal(Math.round((value.pills.income - value.pills.spent) * 100), Math.round(value.pills.net * 100));
  assert.equal(incomeFor(value).reduce((sum, row) => sum + row.amount, 0), value.pills.income);
  assert.equal(value.moved.reduce((sum, row) => sum + row.amount, 0), value.moved_total);
  assert.ok(value.pills.spent - value.notables.reduce((sum, row) => sum + row.spent, 0) - value.unresolved.total >= 0);
  for (const row of value.notables) {
    assert.equal(row.pace.spent, row.spent);
    assert.ok(Math.abs(row.spent - row.pace.usual_by_now - row.excess) < 0.001);
  }
}
assert.match(client, /onMovedTap: \(\) => jump\("g186-moved"\)/);
assert.match(client, /id="g186-moved"/);
assert.match(client, /shell\.style\.overflowX = "clip"/);

console.log("G186 Spend hero fixture and production-boundary checks passed");
