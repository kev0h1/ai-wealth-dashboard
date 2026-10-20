// G201: approved D is the production task directory, not a parallel fixture.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsDirectory, buildSettingsGroups, isSettingsSection, resolveSettingsSection, SETTINGS_SECTIONS } from "../components/settings/SettingsDirectory.tsx";
import { settingsPayPeriodLabel, settingsPlanLabel, settingsIdentityState } from "../lib/settingsNavigation.ts";

const status = {
  accountSummary: "2 sign-in methods", financialSummary: "Income added",
  notificationSummary: "5 topics on", planSummary: "Standard · 113 messages left",
  coverSummary: "Review settings", payPeriodSummary: "Monthly · 25th", assistantsVisible: false,
};
const render = (search = "", changes = {}, active = null) => renderToStaticMarkup(createElement(SettingsDirectory, {
  active, status: { ...status, ...changes }, search, onSearchChange() {}, onPayPeriod() {},
}));
const html = render();
assert.deepEqual(buildSettingsGroups(status).map(g => g.title), [
  "Manage your money", "Make the app yours", "Notifications", "Your account", "Penny and your plan", "Help and information",
], "six approved D groups, in order");
assert.deepEqual(buildSettingsGroups(status)[0].tasks.map(t => t.label), ["Pay period", "Financial profile", "Cover-plan safeguards"]);
assert.match(html, /<nav[^>]*aria-label="Settings tasks"/);
assert.match(html, /<input(?=[^>]*type="search")(?=[^>]*name="settings-search")(?=[^>]*autoComplete="off")/);
assert.match(html, /<button[^>]*>.*?Pay period/s, "pay period is an action, not another detail page");
for (const section of SETTINGS_SECTIONS.filter(s => !["assistants", "delete"].includes(s))) {
  assert.ok(html.includes(`href="/settings?section=${section}"`), `${section} has an addressable real link`);
}
assert.ok(!html.includes("Connected assistants"), "feature-off directory cannot expose assistants");
assert.ok(render("", { assistantsVisible: true }).includes('href="/settings?section=assistants"'));
assert.match(render("", {}, "display"), /<a(?=[^>]*href="\/settings\?section=display")(?=[^>]*aria-current="page")/);
for (const [search, section] of [["income", "financial"], ["PENSION", "financial"], ["Child Benefit", "financial"], ["history", "account"], ["Apple", "account"], [" privacy ", "display"]]) {
  const result = render(search);
  assert.ok(result.includes(`href="/settings?section=${section}"`), `${search} is discoverable`);
  assert.ok(!result.includes("No settings match"));
}
assert.match(render("not-a-setting"), /role="status"[^>]*>No settings match/);
assert.match(render("postcode"), /No settings match/, "removed postcode field is no longer discoverable");
assert.ok(!render("not-a-setting").includes('href="/settings?section='), "no empty sections or stray task links");
assert.ok(!html.includes("undefined"), "no missing values leak into content");
assert.match(html, /Standard · 113 messages left/);
assert.match(html, /Monthly · 25th/);
for (const input of [null, "", "money", "__proto__", "../../account", "delete&confirm=true"]) assert.equal(isSettingsSection(input), false);
for (const section of SETTINGS_SECTIONS) assert.equal(isSettingsSection(section), true);
const resolve = (query, assistantsVisible = false) => resolveSettingsSection(new URLSearchParams(query), assistantsVisible);
assert.equal(resolve(""), null, "bare Settings opens the directory");
assert.equal(resolve("section=not-a-setting"), null, "invalid sections return to the directory");
assert.equal(resolve("section=display"), "display", "recognised sections remain addressable");
assert.equal(resolve("plans=1"), "penny-plan", "legacy resubscribe opens the visible plan section");
assert.equal(resolve("plans=1&section=display"), "display", "a valid explicit section wins over legacy billing parameters");
assert.equal(resolve("billing=success"), "penny-plan", "successful billing returns open the plan section");
assert.equal(resolve("billing=cancelled"), "penny-plan", "cancelled billing returns open the plan section");
assert.equal(resolve("billing=unknown"), null, "unknown billing results return to the directory");
assert.equal(resolve("section=assistants"), null, "MCP-disabled assistant links return to the directory");
assert.equal(resolve("section=assistants", true), "assistants", "MCP-enabled assistant links remain available");
assert.ok(!html.includes("—"), "new directory copy follows British English/no em dash rules");
assert.equal(settingsPayPeriodLabel({type:"last_weekday_of_month",weekday:1}), "Last Monday");
assert.equal(settingsPayPeriodLabel({type:"monthly_pay_date",day:11}), "Monthly · 11th");
assert.equal(settingsPayPeriodLabel({type:"monthly_pay_date",day:21}), "Monthly · 21st");
assert.equal(settingsPayPeriodLabel({type:"weekly",weekday:5}), "Weekly · Friday");
assert.equal(settingsPayPeriodLabel({type:"biweekly",weekday:5,referenceDate:"2026-10-02"}), "Every two weeks · Friday");
assert.equal(settingsPlanLabel(null, false), "Checking…");
assert.equal(settingsPlanLabel(null, true), "Could not load plan");
assert.equal(settingsPlanLabel({tier:"standard",usage:{penny_limit:150,penny_messages:37,penny_remaining:113,penny_topup_messages:100}},true),"Standard · 113 messages left", "server remaining is not inflated by top-ups");
assert.equal(settingsPlanLabel({tier:"standard",usage:{penny_limit:150,penny_messages:151}},true),"Standard · 0 messages left");
assert.deepEqual(settingsIdentityState(null), {googlePrimary:false,applePrimary:false}, "loading cannot claim a primary provider");
assert.deepEqual(settingsIdentityState({primary_email:"sam@example.com",linked:[{provider:"apple",auto:false}]}), {googlePrimary:true,applePrimary:false});
assert.deepEqual(settingsIdentityState({primary_email:"x7k2p9q@privaterelay.appleid.com",linked:[{provider:"apple",auto:true}]}), {googlePrimary:false,applePrimary:true}, "relay-primary cannot display a Google identity");
assert.deepEqual(settingsIdentityState({primary_email:"sam@example.com",linked:[{provider:"apple",auto:true}]}), {googlePrimary:true,applePrimary:false}, "auto-link alone does not prove a relay-primary account");

const page = readFileSync(new URL("../app/settings/SettingsPage.tsx", import.meta.url), "utf8");
assert.ok(page.includes("<SettingsDirectory"), "real page imports the tested directory");
assert.match(page, /resolveSettingsSection\(searchParams, MCP_CONNECTOR\)/, "the page uses the tested query resolver");
assert.match(page, /activeSection === "penny-plan" && <YourPlanCard/, "plan card mounts when its visible section opens so warm resubscribe navigation re-runs its existing URL effect");
assert.match(page, /<YourPlanCard key=\{searchParams\.get\("plans"\) === "1" \? "resubscribe" : "plan"\}/, "resubscribe also re-runs the URL effect from an already-open plan section");
assert.match(page, /identityState\.googlePrimary && <span[\s\S]*?Primary/, "Google primary badge gated by the tested identity model");
assert.match(page, /identityState\.applePrimary \?/, "Apple primary protection uses the same identity model");
assert.match(page, /if \(MCP_CONNECTOR\) fetchConnections\(\)/, "feature-off connector performs no background fetch");
assert.match(page, /deleteConfirm !== "DELETE" \|\| deleting/, "typed guard and duplicate-request guard retained");
assert.match(page, /await api\.deleteUserAccount\(\)/);
assert.match(page, /Could not confirm deletion\. Try again\./, "a failed response must not assert the account was not deleted");
assert.match(page, /clearOnboarded\(localStorage, user\?\.email\)/);
assert.match(page, /<PayPeriodSettingsSheet[\s\S]*?current=\{payPeriodConfig\}[\s\S]*?setPayPeriodConfig/, "pay period uses the real shared preference saver");
for (const handler of ["saveProfile", "handleLinkApple", "handleUnlinkApple", "toggleBiometrics", "handleSyncHistory", "toggleCoverAccount", "toggleNotifPref", "handleRegisterDevice", "handleTestPush", "handleIncomeBlur", "handlePensionBlur", "handleChildBenefitToggle"]) {
  assert.ok(page.includes(handler), `${handler} retained`);
}
assert.match(page, /<PennyPermissionSettings ready=\{preferencesReady\} snapshot=\{rawPrefs\} refresh=\{refreshPreferences\}/, "inline consent uses the shared authoritative preference state");
assert.ok(!page.includes("app/design"), "production has no preview dependency");
assert.ok(!existsSync(new URL("../app/design/settings-overhaul", import.meta.url)), "approved preview removed under H113");
console.log("g201-settings-directory OK: approved D groups, real links, search, feature gates and production handler wiring.");
