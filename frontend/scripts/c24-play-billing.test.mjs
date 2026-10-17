// C24: Google Play Billing guard rails (docs/pricing/store-billing-c13.md
// section 9, B31, B40). Plain Node, no framework, same shape as
// scripts/c21-iap.test.mjs.
//
// What it proves:
//  1. Channel resolution: an Android build whose binary really contains the
//     plugin gets "play" (replacing "Paid plans are not available in this
//     app"); Android without it, any other native build and any uncertain
//     platform gets nothing; Stripe is reachable from the web channel only.
//  2. In the source, no Stripe checkout or portal call is reachable from the
//     Play path, a Google-sourced plan never opens the Stripe portal, and the
//     picker's Stripe branch sits behind the "stripe_web" channel.
//  3. Product ids come from the server's config response, never the client;
//     prices and the free-trial text come from the store's own offer data, and
//     "14 days free" is never written in the Play path.
//  4. The client never grants entitlement: it only posts the purchase token to
//     the server, purchases are made with auto-acknowledge off, and nothing is
//     consumed or acknowledged client-side.
//  5. Plugin hygiene: the Capacitor plugin proxy is never returned from an
//     async function, and the plugin is checked against PluginHeaders.
//  6. The B31 server backstop on the Stripe routes is still in place and
//     covers android.
//
// Run: npm run -s check:c24-play-billing

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolvePurchaseChannel } from "../lib/purchaseChannel.ts";
import { purchaseChannel, usePurchaseChannel, canPurchaseInApp } from "../lib/nativeAuth.ts";
import { describeFreeTrial, periodText, hasPlayPlugin, toProductViews, isCancellation, PURCHASE_FAILED_MESSAGE, PURCHASE_RECORDED_MESSAGE } from "../lib/playBilling.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (rel) => fs.readFileSync(path.resolve(root, rel), "utf8");

let failures = 0;
function check(label, cond) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

// ── 1. Channel resolution ────────────────────────────────────────────────────
const ch = (native, platform, { play = false, storekit = false } = {}) =>
  resolvePurchaseChannel({ native, platform, storekitPluginPresent: storekit, playPluginPresent: play });
check("purchaseChannel on Android with the plugin is \"play\"", ch(true, "android", { play: true }) === "play");
check("Android WITHOUT the plugin resolves to none, never Stripe", ch(true, "android") === "none" && ch(true, "android", { play: false }) === "none");
check("the Play plugin flag alone never makes iOS or an unknown platform purchasable",
  ch(true, "ios", { play: true }) === "none" && ch(true, null, { play: true }) === "none" && ch(true, "weird", { play: true }) === "none");
check("iOS still resolves through StoreKit only", ch(true, "ios", { storekit: true }) === "storekit" && ch(true, "android", { storekit: true }) === "none");
check("web resolves to stripe_web whatever the plugin flags say", ch(false, null, { play: true }) === "stripe_web" && ch(false, "android", { play: true }) === "stripe_web");
check("Stripe is reachable from stripe_web only: no native input ever yields it",
  ["ios", "android", "web", null, "weird"].every((p) => [true, false].every((play) => [true, false].every((storekit) => ch(true, p, { play, storekit }) !== "stripe_web"))));
check("a build with no argument for the Play flag (older callers) never yields play", resolvePurchaseChannel({ native: true, platform: "android", storekitPluginPresent: true }) === "none");

check("plain Node (no Capacitor bridge) behaves as web", purchaseChannel() === "stripe_web" && canPurchaseInApp() === true);
check("the Play plugin is absent in plain Node", hasPlayPlugin() === false);
function Probe() {
  return React.createElement("span", null, usePurchaseChannel());
}
const ssr = renderToStaticMarkup(React.createElement(Probe));
check("usePurchaseChannel renders 'unknown' on an SSR pass, never a purchasable channel", ssr.includes(">unknown<") && !ssr.includes("stripe_web") && !ssr.includes("play<"));

// ── 3. Offer text follows the store ──────────────────────────────────────────
const entry = (id, price, intro, extra = {}) => ({ identifier: id, priceString: price, introductoryPrice: intro, ...extra });
const phase = (units, unit, price = 0) => ({ price, subscriptionPeriod: { numberOfUnits: units, unitString: unit } });
check("a 14 day free phase the store reports is described as 14 days", describeFreeTrial({ introductoryPrice: phase(14, "day") })?.periodText === "14 days");
check("a 3 day phase is described as 3 days, not any fixed length", describeFreeTrial({ introductoryPrice: phase(3, "day") })?.periodText === "3 days");
check("a 1 week phase is singular", describeFreeTrial({ introductoryPrice: phase(1, "week") })?.periodText === "1 week");
check("no offer, no trial", describeFreeTrial({ introductoryPrice: null }) === null && describeFreeTrial({}) === null);
check("a paid introductory phase is not described as free", describeFreeTrial({ introductoryPrice: phase(1, "month", 1.99) }) === null);
check("a malformed period promises nothing", describeFreeTrial({ introductoryPrice: { price: 0, subscriptionPeriod: {} } }) === null && periodText({ numberOfUnits: 0, unitString: "day" }) === null && periodText(undefined) === null && periodText({ numberOfUnits: 2, unitString: "unknown" }) === null);
const views = toProductViews([
  entry("any.id", "£7.77", null, { planIdentifier: "base", offerToken: "tok-plain" }),
  entry("any.id", "£7.77", phase(14, "day"), { planIdentifier: "base", offerToken: "tok-trial" }),
  entry("other.id", "£1.11", null, { planIdentifier: "b2", offerToken: "tok-o" }),
]);
check("the store's own price string is carried untouched", views["any.id"].priceString === "£7.77" && views["other.id"].priceString === "£1.11");
check("an entry carrying a free trial wins over the plain base plan, with its offer token", views["any.id"].freeTrial?.periodText === "14 days" && views["any.id"].offerToken === "tok-trial");
check("an entry with no trial promises none", views["other.id"].freeTrial === null);
check("a trial entry listed first is not displaced by a later plain one",
  toProductViews([entry("a", "£1", phase(7, "day"), { offerToken: "t" }), entry("a", "£1", null, { offerToken: "p" })]).a.offerToken === "t");

// ── Charged versus not charged (F1) ──────────────────────────────────────────
check("only the plugin's USER_CANCELED code is a user cancellation", isCancellation({ code: "USER_CANCELED" }) === true);
check("an error whose text contains 'cancel' is not a cancellation", isCancellation(new Error("Failed to cancel order, server error")) === false
  && isCancellation({ message: "cancelled", code: "ERROR" }) === false && isCancellation("cancel") === false && isCancellation(null) === false);
check("the recorded copy tells the user to tap Restore and the failed copy says not charged",
  /Tap Restore if it does not\.$/.test(PURCHASE_RECORDED_MESSAGE) && /not been charged/.test(PURCHASE_FAILED_MESSAGE) && !/not been charged/.test(PURCHASE_RECORDED_MESSAGE));
check("copy has no em dash or exclamation mark", ![PURCHASE_FAILED_MESSAGE, PURCHASE_RECORDED_MESSAGE].some((m) => /[—!]/.test(m)));

// ── 2/3/4/5. Source assertions ───────────────────────────────────────────────
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const play = stripComments(read("lib/playBilling.ts"));
const picker = stripComments(read("components/PlanPicker.tsx"));
const sheet = stripComments(read("components/MoreMessagesSheet.tsx"));
const yourPlan = stripComments(read("components/YourPlanCard.tsx"));
const api = read("lib/api.ts");
const nativeAuth = read("lib/nativeAuth.ts");

check("playBilling.ts reaches no Stripe checkout or portal", !/startCheckout|openBillingPortal|\/billing\/checkout|\/billing\/portal|stripe/i.test(play));
check("playBilling.ts never navigates the window (no hosted checkout redirect)", !/window\.location|Browser\.open/.test(play));
check("playBilling.ts writes no product id (ids come from the config response)", !/sorted\.(lite|standard|max|penny)|co\.uk\.auriqltd|\.sub\.|\.pack\./.test(play));
check("playBilling.ts writes no price", !/£\s*\d|\d+\.\d\d/.test(play));
check("playBilling.ts writes no trial length", !/\b(2|two|14|fourteen)[- ]days?\b|14[- ]day|free for/i.test(play));
check("purchases read the product id from config.products", (play.match(/config\.products\?\.\[productKey\]/g) ?? []).length === 2);
check("the picker looks products up through playCfg.products, not a literal id", /playCfg\?\.products/.test(picker) && !/sorted\.(lite|standard|max|penny)/.test(picker));
check("the sheet looks packs up through the config, not a literal id", /playCfg\?\.products\?\.\[`penny_\$\{packId\}`\]/.test(sheet) && !/sorted\.(lite|standard|max|penny)/.test(sheet));
check("the config comes from the server's play config route", /getPlayBillingConfig:[\s\S]{0,200}\/billing\/play\/config/.test(api));
check("the purchase carries the obfuscated account id from that config", (play.match(/purchaseProduct\(\{[^}]*?appAccountToken:\s*config\.account_id as string/g) ?? []).length === 2);
check("the client sends the token to the server verify route", /verifyPlayPurchase:[\s\S]{0,300}\/billing\/play\/purchase/.test(api) && /api\.verifyPlayPurchase\(tx\.purchaseToken, tx\.productIdentifier\)/.test(play));
check("the verify route is not given the native-platform header the Stripe routes carry", !/verifyPlayPurchase:[\s\S]{0,400}platformHeaders/.test(api.split("openBillingPortal")[1].split("getIncomeStreams")[0]));
check("purchases are made with auto-acknowledge off, twice", (play.match(/autoAcknowledgePurchases: false/g) ?? []).length === 2);
check("both purchases go through runPurchase, which marks charged once the purchase resolves and then never says 'not charged'",
  (play.match(/return runPurchase\(/g) ?? []).length === 2 && /charged = true;\s*return \(await verify\(tx\)\)/.test(play)
  && /if \(charged \|\| isAlreadyOwned\(err\)\) return \{ ok: false, cancelled: false, message: PURCHASE_RECORDED_MESSAGE \}/.test(play)
  && /if \(!charged && isCancellation\(err\)\)/.test(play));
check("a pack is never consumed client-side", /isConsumable: false/.test(play) && !/consumePurchase|acknowledgePurchase|finishTransaction/.test(play));
check("the plugin is told not to auto-finish, in code and in the native config", /configure\(\{ autoFinishTransactions: false \}\)/.test(play)
  && JSON.parse(read("../capacitor-spike/capacitor.config.json")).plugins?.NativePurchases?.autoFinishTransactions === false);
check("restore is verified server-side and filtered to this account", /export async function restorePlayPurchases/.test(play) && /getPurchases\(/.test(play) && /tx\.appAccountToken !== config\.account_id/.test(play));
check("cancel and plan change point at Google Play", /export async function openManagePlaySubscriptions/.test(play) && /plugin\.manageSubscriptions\(\)/.test(play));
check("the plugin proxy is never returned from an async function", !/return\s+(plugin|play\.plugin|mod\.NativePurchases|NativePurchases)\s*;/.test(play) && /plugin: mod\.NativePurchases/.test(play));
check("the plugin is gated on Capacitor.PluginHeaders before any call", /PluginHeaders/.test(play) && /hasPlayPlugin\(\)\)\s*throw/.test(play));
check("the plugin is imported dynamically so web bundles never load it", /await import\("@capgo\/native-purchases"\)/.test(play) && !/^import\s+\{[^}]*\}\s+from\s+"@capgo\/native-purchases"/m.test(play));
check("a live Play subscription is never stacked with a second purchase", /subscription_managed_in_play/.test(play) && /Change or cancel your plan in Google Play/.test(play));

const iStart = picker.indexOf("async function handlePrimary");
const iCheckout = picker.indexOf("api.startCheckout(");
const iPlayBuy = picker.indexOf("if (playBuy)", iStart);
const iPlayManaged = picker.indexOf("if (playManaged)", iStart);
const iGuard = picker.indexOf('if (!purchasingAllowed && (billingChangeInPortal || selected !== "statements"))', iStart);
check("the picker's Stripe checkout call still exists exactly once", iCheckout > 0 && picker.indexOf("api.startCheckout(", iCheckout + 1) === -1);
check("the Play branches return before the B26 guard, and the guard returns before checkout",
  iPlayManaged > iStart && iPlayBuy > iPlayManaged && iGuard > iPlayBuy && iCheckout > iGuard
  && /\{\s*setBusy\(false\);\s*return;\s*\}/.test(picker.slice(iGuard, iGuard + 240)));
check("purchasingAllowed (Stripe) is the stripe_web channel and nothing else", /const purchasingAllowed = nativeOverride === undefined \? channel === "stripe_web" : !nativeOverride;/.test(picker));
check("the Play flag cannot be enabled by the design preview override", /const play = nativeOverride === undefined && channel === "play";/.test(picker));
check("a Google-sourced plan never opens the Stripe portal", /billingChangeInPortal = context === "settings" && managedPaidSubscription && info\.billing_provider !== "apple" && info\.billing_provider !== "google";/.test(picker)
  && /if \(playManaged\) \{\s*if \(play\) await openManagePlaySubscriptions\(\)/.test(picker));
check("the picker has no \"14 days\" text in its Play branches", !/playBuy[^;\n]*14|14[- ]day[^;\n]*playBuy/.test(picker)
  && /\$\{trial\.periodText\} free, then \$\{selectedPlayView\.priceString\}/.test(picker));
check("the packs sheet buys through Play only on the play channel and keeps its Stripe path behind purchasingAllowed",
  /usePurchaseChannel\(\) === "play"/.test(sheet) && /onBuy=\{\(\) => \(play \? buyOnPlay\(pack\.id\) : buy\("pack", pack\.id\)\)\}/.test(sheet)
  && /if \(pendingId \|\| !purchasingAllowed\) return;/.test(sheet));
check("Your plan shows no Stripe fix-payment button for a Google plan", /channel === "stripe_web" && !appleSourced && !googleSourced/.test(yourPlan) && /googleManageLine/.test(yourPlan));
check("purchaseChannel in nativeAuth passes the Play plugin flag", /playPluginPresent: native && hasPlayPlugin\(\)/.test(nativeAuth));
check("the B26 canPurchaseInApp() gate is unchanged (still false on any native build)", /return !Capacitor\.isNativePlatform\(\);/.test(nativeAuth));
check("the legacy 'not available' sentence is still the fallback for no channel", /PURCHASE_UNAVAILABLE_SENTENCE = "Paid plans are not available in this app\."/.test(nativeAuth));

for (const rel of ["lib/playBilling.ts", "lib/purchaseChannel.ts"]) {
  check(`${rel} has no em dashes`, !read(rel).includes("—"));
}
check("the Google copy added to billingCopy has no em dashes", !/paymentFailedBodyGoogle[\s\S]{0,700}—/.test(read("lib/billingCopy.ts")));
check("the Play copy in the picker and sheet has no em dashes", !/PLAY_MANAGE_LINE[^\n]*—/.test(read("components/PlanPicker.tsx")) && !/Google Play[^\n]*—/.test(picker + sheet));

// ── Plugin pinned identically in the app and the native shell ────────────────
const pin = (rel) => JSON.parse(read(rel)).dependencies["@capgo/native-purchases"];
const lockVersion = (rel) => JSON.parse(read(rel)).packages["node_modules/@capgo/native-purchases"]?.version;
check("plugin is pinned to one exact version in frontend and capacitor-spike", /^\d+\.\d+\.\d+$/.test(pin("package.json")) && pin("package.json") === pin("../capacitor-spike/package.json"));
check("both lockfiles agree with the pin", lockVersion("package-lock.json") === pin("package.json") && lockVersion("../capacitor-spike/package-lock.json") === pin("package.json"));

// ── 6. B31 server backstop still in force ────────────────────────────────────
const billingRouter = read("../backend/app/routers/billing.py");
check("B31 backstop still guards checkout and portal and names android", /_reject_native_platform\(request, user, endpoint="POST \/billing\/checkout"\)/.test(billingRouter)
  && /_reject_native_platform\(request, user, endpoint="POST \/billing\/portal"\)/.test(billingRouter) && /_NATIVE_PLATFORM_VALUES = \{"ios", "android", "native"\}/.test(billingRouter));
check("the client still sends the platform header on the Stripe routes", /startCheckout:[\s\S]{0,400}platformHeaders\(\)/.test(api) && /openBillingPortal:[^\n]*platformHeaders\(\)/.test(api));
const playRouter = read("../backend/app/routers/play_billing.py");
check("the Play verify route grants nothing itself: it calls the server verifier", /play_billing\.verify_client_purchase\(/.test(playRouter) && !/subscriptions_col|grant_pack|upsert_store_subscription/.test(playRouter));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log("\nAll checks passed");
}
