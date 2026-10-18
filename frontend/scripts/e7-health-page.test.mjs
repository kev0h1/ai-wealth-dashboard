// E7: pins the /ops/health collector sections and the plain wording for
// states a source can be in, so a section cannot silently disappear and an
// unconfigured or hanging source is never shown as a blank or a spinner.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { SECTIONS, TRENDS_TITLE, WORDING } from "../app/ops/health/sections.ts";

assert.deepEqual(
  SECTIONS.map((s) => s.key),
  ["api_latency", "finexer_sync", "worker", "llm_tavily", "mongo", "vps", "railway", "vercel", "push"],
);
assert.deepEqual(
  SECTIONS.map((s) => s.title),
  ["API latency", "Sync health", "Worker queue", "Spend and Tavily", "Database", "Server status", "Railway", "Vercel", "Push delivery"],
);
assert.equal(TRENDS_TITLE, "Trends");
assert.equal(WORDING.notConfigured, "Not configured");
assert.equal(WORDING.timedOut, "Timed out");

const page = readFileSync(new URL("../app/ops/health/page.tsx", import.meta.url), "utf8");
assert.match(page, /SECTIONS\.map/, "page renders every section from the pinned list");
assert.match(page, /WORDING\.timedOut/);
assert.match(page, /WORDING\.notConfigured/);
assert.match(page, /api\.getOpsCollector\(section\.key\)/, "each section loads its own collector");
assert.match(page, /api\.getOpsTrends/);
for (const s of SECTIONS) assert.ok(page.includes(`case "${s.key}"`), `renderer for ${s.key}`);
assert.ok(!/—/.test(page + readFileSync(new URL("../app/ops/health/sections.ts", import.meta.url), "utf8")), "no em dashes in copy");
console.log("e7-health-page: ok");
