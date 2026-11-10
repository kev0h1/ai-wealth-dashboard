// A195: pins the read-only "On the default plan" report on /ops/people. It
// must call the owner-only endpoint, write nothing, show counts, names and the
// tier today versus after, and carry no em dashes in its copy.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { DEFAULT_TIER_WORDING, defaultTierSummary, tierLabel } from "../app/ops/people/people.ts";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const section = read("../app/ops/people/DefaultTierSection.tsx");
const page = read("../app/ops/people/page.tsx");
const apiSrc = read("../lib/api.ts");

assert.ok(apiSrc.includes('"/ops/people/default-tier"'), "api.ts calls the owner-only endpoint");
assert.match(apiSrc, /getOpsDefaultTierReport: \(\) => get</, "report is a GET");
assert.match(page, /<DefaultTierSection \/>/, "the page renders the report");
assert.match(section, /api\s*\.getOpsDefaultTierReport\(\)/);
assert.ok(!/\.(post|put|patch|delete)\(|api\.(set|grant|reset|cancel|allow|revoke|invite)/i.test(section), "read-only: no write call");
assert.match(section, /p\.display_name/);
assert.match(section, /tierLabel\(p\.tier_today\)/);
assert.match(section, /tierLabel\(p\.tier_after\)/);

assert.equal(tierLabel("plus"), "Plus");
assert.equal(
  defaultTierSummary({ default_only_count: 3, would_change_count: 3, configured_default: "plus", code_default: "statements" }),
  "3 people are on plus only by default. 3 would move to statements when the new default applies.",
);
assert.equal(
  defaultTierSummary({ default_only_count: 1, would_change_count: 1, configured_default: "plus", code_default: "statements" }),
  "1 person is on plus only by default. 1 would move to statements when the new default applies.",
);
assert.match(
  defaultTierSummary({ default_only_count: 2, would_change_count: 0, configured_default: "statements", code_default: "statements" }),
  /None would change/,
);
assert.equal(
  defaultTierSummary({ default_only_count: 0, would_change_count: 0, configured_default: "plus", code_default: "statements" }),
  DEFAULT_TIER_WORDING.empty,
);

const copy = [section, ...Object.values(DEFAULT_TIER_WORDING)].join("\n");
assert.ok(!/—/.test(copy), "no em dashes");
console.log("a195-default-tier-report ok");
