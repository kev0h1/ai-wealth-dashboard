// G282 (Kevin 2026-10-17): one account display name everywhere, one rhythm.
//  1. The shared table (shared/account-name-cases.json, also run by the backend
//     test) against lib/accountName.ts.
//  2. The Accounts rows, the pickers, Upcoming by account, Spend from and the
//     Home estate go through displayAccountName.
//  3. AccountsPage uses the Page Rhythm (no mt-4 / pt-4 / pb-4 / mt-8 between
//     blocks of the list) and the preview mirrors the RHYTHM classes.
// Run: npm run -s check:g282-account-names

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { displayAccountName, tidyAccountName } from "../lib/accountName.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const table = JSON.parse(readFileSync(new URL("../../shared/account-name-cases.json", import.meta.url), "utf8"));
for (const [i, o] of table) assert.equal(displayAccountName(i), o, `displayAccountName(${JSON.stringify(i)})`);
assert.equal(tidyAccountName("THE NUMBER ONE"), "The Number One");
assert.equal(displayAccountName(null), "");

for (const f of [
  "lib/accountsEstate.ts", "components/AccountRadioPicker.tsx", "lib/spendFromAccount.ts", "lib/upcomingAccountWalk.ts",
  "components/upcoming/UpcomingAccountsCard.tsx", "components/HomeEstateSection.tsx", "components/CommitmentSheet.tsx",
  "components/SetAsideSheet.tsx", "components/AllocationEditForm.tsx", "components/CoverPlanSourcesCard.tsx",
]) {
  assert.match(read(f), /displayAccountName|tidyAccountName/, `${f} uses the shared account name`);
}
assert.match(read("components/AccountRadioPicker.tsx"), /displayAccountName\(account\.name\)/, "pickers use the shared name");
assert.match(read("lib/accountsEstate.ts"), /name: displayAccountName\(a\.name\)/, "Accounts rows use the shared name");
assert.ok(!/account\.manual \? account\.name/.test(read("components/AccountRadioPicker.tsx")), "no raw manual name in the picker");

const page = read("app/components/AccountsPage.tsx");
const list = page.slice(page.lastIndexOf("{connectNotice && ("));
assert.ok(!/\b(?:mt-4|pt-4|pb-4|mt-6|pt-6|mt-8)\b/.test(list.slice(0, list.indexOf("Offline accounts"))), "Accounts list has no ad hoc 16/24/32px margins");
assert.match(page, /className="px-4 pt-5"/, "Accounts header block is pt-5");
assert.match(list, /px-4 pt-3 space-y-3/, "Accounts list is one 12px group");
assert.match(list, /px-4 mt-5/, "Offline accounts is a 20px section");

assert.match(page, /name=\{displayAccountName\(selectedAccount\.name\)\}/, "Accounts detail header uses the shared name");
assert.match(page, /rule\.source_account_name \? displayAccountName/, "rule source name uses the shared name");
assert.match(read("components/HomeBrief.tsx"), /displayAccountName\(m\.source_name\)/, "move rows use the shared name");
assert.match(read("components/TeachingSheet.tsx"), /displayAccountName\(account\.name\)/, "teaching sheet uses the shared name");
assert.match(read("components/MiscategorisedReviewSheet.tsx"), /displayAccountName\(account\.name\)/, "review sheet uses the shared name");
// The payday plan card renders names the companion has already cased server-side (_clean_name -> display_account_name).
assert.match(readFileSync(new URL("../../backend/app/services/companion.py", import.meta.url), "utf8"), /return display_account_name\(cleaned\) if cleaned else fallback/, "companion _clean_name applies the shared name for the payday plan card");
assert.match(read("app/components/AccountsPage.tsx"), /pb-0\.5 -mx-1 px-1|AccountsEstateControls/, "chip row present");
assert.match(read("components/AccountsEstateControls.tsx"), /pb-0\.5/, "chip row keeps 2px bottom room");

const preview = read("app/design/home-accounts-rhythm/HomeAccountsRhythmClient.tsx");
assert.match(preview, /top: "pt-5", brief: "space-y-3", section: "mt-5", label: "mb-2", group: "space-y-3", tail: "pb-5", accountsFirst: "pt-3"/, "preview rhythm mirrors production");
assert.ok(!/—/.test(preview), "no em dash in the preview");
console.log("g282-account-names: ok");
