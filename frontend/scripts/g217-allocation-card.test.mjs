// G217: the production HomeBrief card tokens must stay exactly what shipped
// (the round only exported them), and the allocation preview must stay calm.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const brief = readFileSync(new URL("../components/HomeBrief.tsx", import.meta.url), "utf8");
const grab = (name) => {
  const m = brief.match(new RegExp(`const ${name} =\\s*(?:"([^"]*)"|\`([^\`]*)\`)`));
  assert.ok(m, `${name} missing`);
  return m[1] ?? m[2];
};
assert.equal(grab("BRIEF_CARD"), "relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800");
assert.equal(grab("ACTION_DOCK"), "-mx-4 -mb-4 mt-4 border-t border-slate-100 bg-slate-50/80 px-4 py-3 dark:border-slate-700/70 dark:bg-slate-900/25");
assert.match(grab("PRIMARY_ACTION"), /bg-indigo-600 text-white/);
assert.match(grab("SECONDARY_ACTION"), /border border-slate-200 bg-white text-slate-700/);
assert.match(brief, /data-move-card="compact-handoff" className=\{`\$\{BRIEF_CARD\} p-4`\}/);
assert.match(brief, /tone=\{hasOverdueBills \? "watch" : "neutral"\}>Cover plan</);
assert.match(brief, /<Link href=\{item\.action\.route\} className=\{`\$\{PRIMARY_ACTION\} w-full`\}>/);
for (const n of ["BRIEF_CARD", "SECONDARY_ACTION", "BriefIcon", "KindLabel", "DismissChip", "MoveAccountIcon"]) {
  assert.match(brief, new RegExp(`export (const|function) ${n}\\b`), `${n} must stay exported`);
}
const variants = readFileSync(new URL("../app/design/allocation-shortfall/Variants.tsx", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
assert.doesNotMatch(variants, /\b(red|rose|amber)-\d|BRAND_GRADIENT|PennyKindLabel|PennyMark/);
assert.doesNotMatch(variants, /\u2014/);
console.log("g217-allocation-card OK");
