// G283 (Kevin, 2026-10-17): tips state facts only. No saving is claimed or
// estimated, nothing is recommended, no product is called the best option.
//
//  1. The Home "saved" stat is gone: ValueDeliveredStat.tsx does not exist and
//     nothing in the frontend imports it or calls GET /value-delivered.
//  2. No frontend source reads the removed money fields (savings_estimate,
//     verified_savings, verified_monthly_saving, total_monthly_saving).
//  3. The tips components and strings never contain a banned phrase (the same
//     list as backend/app/services/tip_copy.py): save, saves, saved, saving,
//     savings, cut, cheaper, could, should, recommend, best, worth switching,
//     switch to. Comments, URLs and the workflow drawer (the form that stores
//     the user's own answers) are not tip text and are excluded.
//  4. The tip sublines are a count and nothing else.
//
// Run: npm run -s check:g283-no-savings-claims

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tipSubline, tipsLineText } from "../lib/spendTips.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// The banned list, mirrored from tip_copy.py. Allowed: the category name
// "Savings" (capital S) and "savings account"/"pot"/"ISA".
const ALLOWED = /\bSavings\b|\bsavings\s+(?:accounts?|pots?|ISAs?|goals?|buffers?)\b/g;
const BANNED = /\b(?:save|saves|saved|saving|savings|cut|cuts|cutting|cheaper|cheapest|could|should|recommend\w*|best|worth\s+switching|switch(?:ing)?\s+to)\b/i;
const bannedIn = (text) => BANNED.exec(text.replace(ALLOWED, " "))?.[0] ?? null;

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"\w])\/\/[^\n]*/g, "$1");
const stripUrls = (src) => src.replace(/https?:\/\/[^\s"'`)]+/g, "");

// 1. the stat is gone
assert.ok(!existsSync(path.join(root, "components/ValueDeliveredStat.tsx")), "ValueDeliveredStat.tsx must not exist");

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (["node_modules", ".next", ".next-prev", "dist", "out"].includes(e)) continue;
    const full = path.join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(e)) out.push(full);
  }
  return out;
}
const self = path.join(root, "scripts/g283-no-savings-claims.test.mjs");
const REMOVED = [
  "ValueDeliveredStat", "value-delivered", "valueDelivered", "savings_estimate", "verified_savings",
  "verified_monthly_saving", "total_monthly_saving", "verified_savings_line", "InsightsHero",
];
for (const file of walk(root)) {
  if (file === self) continue;
  const code = stripComments(readFileSync(file, "utf8"));
  for (const word of REMOVED) {
    // fixtures in other scripts may mention a removed name only inside a comment
    assert.ok(!code.includes(word), `${path.relative(root, file)} still uses removed name ${word}`);
  }
}

// 3. banned phrases in the tips components and strings
function workflowDrawerRemoved(src) {
  const a = src.indexOf("function WorkflowDrawer(");
  const b = src.indexOf("const KNOWN_INITIALISMS");
  return a >= 0 && b > a ? src.slice(0, a) + src.slice(b) : src;
}
const TIP_FILES = [
  "components/InsightCard.tsx",
  "components/TipsLine.tsx",
  "components/HomeInsightSpotlight.tsx",
  "lib/spendTips.ts",
  "app/design/spend-live/tips.ts",
];
for (const rel of TIP_FILES) {
  let src = stripUrls(stripComments(read(rel)));
  if (rel.endsWith("InsightCard.tsx")) src = workflowDrawerRemoved(src);
  src.split("\n").forEach((line, i) => {
    const hit = bannedIn(line);
    assert.equal(hit, null, `${rel}:${i + 1} contains banned phrase "${hit}": ${line.trim().slice(0, 100)}`);
  });
}
// the tip-shaped fixtures of the insights-live twin (SavingsInsight payloads
// only, not the money-shape fixtures further down)
{
  const fx = read("app/design/insights-live/fixtures.ts");
  const tipPart = stripComments(fx.slice(0, fx.indexOf("MONEY_SHAPE")));
  tipPart.split("\n").forEach((line, i) => {
    if (!/^\s*(title|body|stopped_line|substituted_line|expiry_line):/.test(line)) return;
    assert.equal(bannedIn(line), null, `insights-live/fixtures.ts:${i + 1} ${line.trim().slice(0, 100)}`);
  });
}

// the banned-phrase detector itself
for (const bad of ["Could save £5", "A cheaper plan", "You should switch to X", "The best deal", "worth switching"]) {
  assert.notEqual(bannedIn(bad), null, `detector must flag "${bad}"`);
}
for (const ok of ["You pay EE £57 a month.", "Savings", "Your savings account", "Checked 14 Oct, source uswitch.com."]) {
  assert.equal(bannedIn(ok), null, `detector must not flag "${ok}"`);
}

// 4. sublines are a count only
const t = (id) => ({ id });
assert.equal(tipSubline([]), null);
assert.equal(tipSubline([t("a")]), "1 tip");
assert.equal(tipSubline([t("a"), t("b")]), "2 tips");
assert.equal(tipsLineText("Bills", [t("a")]), "1 tip for Bills");
assert.equal(tipsLineText("Bills", [t("a"), t("b")]), "2 tips for Bills");
assert.ok(!/[£~]/.test(tipSubline([t("a"), t("b")]) + tipsLineText("Bills", [t("a")])), "no figure in a tip subline");

console.log("g283-no-savings-claims: ok");
