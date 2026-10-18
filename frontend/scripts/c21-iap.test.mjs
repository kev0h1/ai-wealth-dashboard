// C21: StoreKit in-app purchase guard rails (docs/pricing/store-billing-c13.md
// sections 6 and 9, B31, B40). Plain Node, no framework, same shape as
// scripts/purchase-availability-ssr.test.mjs.
//
// What it proves:
//  1. Channel resolution: Stripe Checkout is reachable from the web channel
//     only. A native iOS build gets StoreKit (and only when the plugin is
//     really in the binary), every other native build and every uncertain
//     platform gets nothing.
//  2. In the source, no Stripe checkout or portal call is reachable from the
//     StoreKit path, and the picker's Stripe branch sits behind the
//     "stripe_web" channel.
//  3. No product id, price or trial length is written in client code: ids come
//     from the server's config response, prices and the free-trial length
//     from the store's own product data.
//  4. The offer text follows the store: a 3 day or 1 month offer is described
//     as that, an ineligible or unknown user is promised nothing.
//  5. Plugin hygiene: the Capacitor plugin proxy is never returned from an
//     async function, and the plugin is checked against PluginHeaders.
//  6. The B31 server backstop on the Stripe routes is still in place.
//
// Run: npm run -s check:c21-iap

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolvePurchaseChannel } from "../lib/purchaseChannel.ts";
import { purchaseChannel, usePurchaseChannel, canPurchaseInApp } from "../lib/nativeAuth.ts";
import { describeFreeTrial, periodText, hasStoreKitPlugin, toProductView } from "../lib/storekit.ts";

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
const ch = (native, platform, plugin) => resolvePurchaseChannel({ native, platform, storekitPluginPresent: plugin });
check("web resolves to stripe_web", ch(false, null, false) === "stripe_web" && ch(false, "web", false) === "stripe_web");
check("native iOS with the plugin resolves to storekit", ch(true, "ios", true) === "storekit");
check("native iOS WITHOUT the plugin resolves to none, never Stripe", ch(true, "ios", false) === "none");
check("native Android resolves to none even if a plugin were present", ch(true, "android", true) === "none" && ch(true, "android", false) === "none");
check("an uncertain platform (native, platform unknown) resolves to none", ch(true, null, false) === "none" && ch(true, null, true) === "none");
check("Stripe is reachable from stripe_web only: no native input ever yields it",
  ["ios", "android", "web", null, "weird"].every((p) => [true].every((n) => ch(n, p, true) !== "stripe_web" && ch(n, p, false) !== "stripe_web")));

check("plain Node (no Capacitor bridge) behaves as web", purchaseChannel() === "stripe_web" && canPurchaseInApp() === true);
check("plugin absent in plain Node", hasStoreKitPlugin() === false);
function Probe() {
  return React.createElement("span", null, usePurchaseChannel());
}
const ssr = renderToStaticMarkup(React.createElement(Probe));
check("usePurchaseChannel renders 'unknown' on an SSR pass, never a purchasable channel", ssr.includes(">unknown<") && !ssr.includes("stripe_web") && !ssr.includes("storekit"));

// ── 4. Offer text follows the store ──────────────────────────────────────────
const offer = (units, unit, mode = 2, price = 0) => ({ price, paymentMode: mode, subscriptionPeriod: { numberOfUnits: units, unitString: unit } });
check("a 2 week free trial the store reports is described as 2 weeks", describeFreeTrial({ introductoryPrice: offer(2, "week"), introEligibility: 2 })?.periodText === "2 weeks");
check("a 3 day offer is described as 3 days, not as any fixed length", describeFreeTrial({ introductoryPrice: offer(3, "day"), introEligibility: 2 })?.periodText === "3 days");
check("a 1 month offer is described as 1 month (singular)", describeFreeTrial({ introductoryPrice: offer(1, "month"), introEligibility: 2 })?.periodText === "1 month");
check("an ineligible user is promised no trial", describeFreeTrial({ introductoryPrice: offer(2, "week"), introEligibility: 1 }) === null);
check("an unknown eligibility promises no trial", describeFreeTrial({ introductoryPrice: offer(2, "week"), introEligibility: 0 }) === null && describeFreeTrial({ introductoryPrice: offer(2, "week") }) === null);
check("no store offer, no trial", describeFreeTrial({ introductoryPrice: null, introEligibility: 2 }) === null);
check("a paid introductory offer is not described as free", describeFreeTrial({ introductoryPrice: offer(1, "month", 0, 1.99), introEligibility: 2 }) === null);
check("a malformed period promises nothing", describeFreeTrial({ introductoryPrice: { price: 0, paymentMode: 2, subscriptionPeriod: {} }, introEligibility: 2 }) === null && periodText({ numberOfUnits: 0, unitString: "day" }) === null && periodText(undefined) === null);
const view = toProductView({ identifier: "any.id.from.store", priceString: "£7.77", introductoryPrice: offer(2, "week"), introEligibility: 2 });
check("the product view carries the store's own price string untouched", view.priceString === "£7.77" && view.productId === "any.id.from.store" && view.freeTrial.periodText === "2 weeks");

// ── 2/3/5. Source assertions ─────────────────────────────────────────────────
// Code only: whole-line and block comments removed, so a comment that
// explains a rule ("never Stripe", "not 2 weeks") cannot trip the check on it.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const storekit = stripComments(read("lib/storekit.ts"));
const picker = stripComments(read("components/PlanPicker.tsx"));
const api = read("lib/api.ts");
const nativeAuth = read("lib/nativeAuth.ts");

check("storekit.ts reaches no Stripe checkout or portal", !/startCheckout|openBillingPortal|\/billing\/checkout|\/billing\/portal|stripe/i.test(storekit));
check("storekit.ts never navigates the window (no hosted checkout redirect)", !/window\.location|Browser\.open/.test(storekit));
check("storekit.ts writes no product id (ids come from the config response)", !/sorted\.|co\.uk\.auriqltd|\.sub\.|\.pack\./.test(storekit));
check("storekit.ts writes no price", !/£\s*\d|\d+\.\d\d/.test(storekit));
check("storekit.ts writes no trial length", !/\b(2|two) weeks\b|14[- ]day|14 days|fourteen/i.test(storekit));
check("purchase reads the product id from config.products", /config\.products\[productKey\]/.test(storekit));
check("the picker looks products up through iap.products, not a literal id", /iap\.products\[/.test(picker) && !/sorted\.(lite|standard|plus|max|penny)/.test(picker));
check("the config comes from the server's account-token route", /getAppleIapConfig:[\s\S]{0,200}\/billing\/apple\/account-token/.test(api));
check("the purchase carries the appAccountToken from that config", /appAccountToken:\s*config\.app_account_token/.test(storekit));
check("a purchase is verified by the server before it is finished", /verifyAppleTransaction\(tx\.jwsRepresentation\)[\s\S]{0,200}finishTransaction/.test(storekit));
check("restore purchases exists and is verified server-side", /export async function restorePurchases/.test(storekit) && /restorePurchases\(\)/.test(storekit) && /verifyAndFinish/.test(storekit));
check("the picker offers Restore purchases on the StoreKit channel only", /storekit && iap\?\.enabled && \(\s*<button[\s\S]{0,1600}Restore purchases/.test(picker));
check("the plugin proxy is never returned from an async function", !/return\s+(plugin|sk\.plugin|mod\.NativePurchases|NativePurchases)\s*;/.test(storekit) && /plugin: mod\.NativePurchases/.test(storekit));
check("the plugin is gated on Capacitor.PluginHeaders before any call", /PluginHeaders/.test(storekit) && /hasStoreKitPlugin\(\)\)\s*throw/.test(storekit));
check("the plugin is imported dynamically so web bundles never load it", /await import\("@capgo\/native-purchases"\)/.test(storekit) && !/^import\s+\{[^}]*\}\s+from\s+"@capgo\/native-purchases"/m.test(storekit));

const iStart = picker.indexOf("async function handlePrimary");
const iCheckout = picker.indexOf("api.startCheckout(");
const iStoreBuy = picker.indexOf("if (storeBuy)", iStart);
const iGuard = picker.indexOf('if (!purchasingAllowed && (billingChangeInPortal || selected !== "statements"))', iStart);
check("the picker's Stripe checkout call exists exactly once", iCheckout > 0 && picker.indexOf("api.startCheckout(", iCheckout + 1) === -1);
check("the StoreKit branch returns before the B26 guard, and the guard returns before checkout", iStoreBuy > iStart && iGuard > iStoreBuy && iCheckout > iGuard
  && /\{\s*setBusy\(false\);\s*return;\s*\}/.test(picker.slice(iGuard, iGuard + 240)));
check("purchasingAllowed is the stripe_web channel and nothing else", /const purchasingAllowed = nativeOverride === undefined \? channel === "stripe_web" : !nativeOverride;/.test(picker));
check("the picker no longer decides from canPurchaseInApp()", !/canPurchaseInApp\(/.test(picker));
check("the StoreKit flag cannot be enabled by the design preview override", /const storekit = nativeOverride === undefined && channel === "storekit";/.test(picker));
check("an Apple-sourced plan never opens the Stripe portal", /billingChangeInPortal = context === "settings" && managedPaidSubscription && info\.billing_provider !== "apple"/.test(picker) && /if \(appleManaged\) \{\s*if \(storekit\) await openManageSubscriptions\(\)/.test(picker));
check("manage copy for an Apple plan points at iOS Settings", /iOS Settings, under Subscriptions/.test(picker));
check("channel hook lives in nativeAuth and resolves through the pure function", /resolvePurchaseChannel\(\{ native, platform, storekitPluginPresent: native && hasStoreKitPlugin\(\) \}\)/.test(nativeAuth));
check("the B26 canPurchaseInApp() gate is unchanged (still false on any native build)", /return !Capacitor\.isNativePlatform\(\);/.test(nativeAuth));

for (const rel of ["lib/storekit.ts", "lib/purchaseChannel.ts"]) {
  check(`${rel} has no em dashes`, !read(rel).includes("—"));
}
check("the Apple copy added to billingCopy has no em dashes", !/paymentFailedBodyApple[\s\S]{0,700}—/.test(read("lib/billingCopy.ts")));

// ── Plugin pinned identically in the app and the native shell ────────────────
const pin = (rel) => JSON.parse(read(rel)).dependencies["@capgo/native-purchases"];
const lockVersion = (rel) => JSON.parse(read(rel)).packages["node_modules/@capgo/native-purchases"]?.version;
check("plugin is pinned to one exact version in frontend and capacitor-spike", /^\d+\.\d+\.\d+$/.test(pin("package.json")) && pin("package.json") === pin("../capacitor-spike/package.json"));
check("both lockfiles agree with the pin", lockVersion("package-lock.json") === pin("package.json") && lockVersion("../capacitor-spike/package-lock.json") === pin("package.json"));

// ── 6. B31 server backstop still in force ────────────────────────────────────
const billingRouter = read("../backend/app/routers/billing.py");
check("B31 backstop still guards checkout and portal and still names ios", /_reject_native_platform\(request, user, endpoint="POST \/billing\/checkout"\)/.test(billingRouter)
  && /_reject_native_platform\(request, user, endpoint="POST \/billing\/portal"\)/.test(billingRouter) && /_NATIVE_PLATFORM_VALUES = \{"ios", "android", "native"\}/.test(billingRouter));
check("the client still sends the platform header on the Stripe routes", /startCheckout:[\s\S]{0,400}platformHeaders\(\)/.test(api) && /openBillingPortal:[^\n]*platformHeaders\(\)/.test(api));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log("\nAll checks passed");
}
