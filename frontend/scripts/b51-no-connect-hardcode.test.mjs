// B51: the Connect plan must not be offered in production, so no client
// surface may carry a hard-coded Connect plan. The plan list comes from the
// server's GET /subscription `available_tiers` (omits Connect unless
// CONNECT_TIER_ENABLED), and PlanPicker's own tier metadata is only ever
// filtered through it. Source scan, no React.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

// 1. PlanPicker renders only the server's list.
const picker = read("components/PlanPicker.tsx");
assert.match(picker, /available_tiers/, "PlanPicker must read info.available_tiers");
assert.match(picker, /function tiersFromServer/, "PlanPicker must filter its tier metadata through tiersFromServer");
assert.match(picker, /const TIERS = useMemo\(\(\) => tiersFromServer\(/, "TIERS must be derived from the server list");
assert.doesNotMatch(picker, /^const TIERS\b/m, "no module-level hard-coded TIERS list");
const allTiersUses = picker.match(/ALL_TIERS/g) ?? [];
assert.ok(allTiersUses.length <= 4, "ALL_TIERS is metadata only, used inside tiersFromServer");
// fail-closed default when the payload has no list: Connect excluded
assert.match(picker, /filter\(\(id\) => id !== "connect"\)/, "missing available_tiers must exclude Connect");

// 2. No other plan/onboarding/store surface hard-codes a Connect plan.
const surfaces = [
  "components/Onboarding.tsx", "components/YourPlanCard.tsx", "components/MoreMessagesSheet.tsx",
  "lib/billingCopy.ts", "lib/settingsNavigation.ts", "lib/pennyScreenConfig.tsx",
];
for (const file of surfaces) {
  let src;
  try { src = read(file); } catch { continue; }
  assert.doesNotMatch(src, /id:\s*["']connect["']/, `${file}: hard-coded Connect plan entry`);
  assert.doesNotMatch(src, /name:\s*["']Connect["']/, `${file}: hard-coded Connect plan name`);
  assert.doesNotMatch(src, /["']lite["'],\s*["']standard["'],\s*["']connect["']/, `${file}: hard-coded tier list with Connect`);
}

// 3. The Connect assistants card words its upsell from the server list.
const card = read("components/ConnectedAssistantsCard.tsx");
assert.match(card, /connectOffered/, "ConnectedAssistantsCard must take connectOffered");
const settings = read("app/settings/SettingsPage.tsx");
assert.match(settings, /available_tiers\?\.includes\("connect"\)/, "SettingsPage passes the server's Connect availability");

// 4. No native store route (iOS IAP / Play) references a Connect SKU.
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "design", "ops", "remotion", "out"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !name.startsWith("b51-")) out.push(full);
  }
  return out;
}
for (const file of [...walk(join(root, "components")), ...walk(join(root, "lib")), ...walk(join(root, "app"))]) {
  const src = readFileSync(file, "utf8");
  assert.doesNotMatch(src, /sorted\.sub\.connect|sub\.connect\.(monthly|six_months|annual)/, `${relative(root, file)}: Connect store SKU`);
}

console.log("b51-no-connect-hardcode: ok");
