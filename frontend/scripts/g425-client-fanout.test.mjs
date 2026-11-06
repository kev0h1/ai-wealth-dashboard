// G425: source assertions that the screens use the shared loaders.
// Run: npm run -s check:g425-client-fanout
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
let failures = 0;
function check(label, ok) { if (ok) console.log(`ok   ${label}`); else { failures++; console.error(`FAIL ${label}`); } }

const home = read("app/components/HomePage.tsx");
const spend = read("app/components/SpendPage.tsx");
const transfers = read("components/HomeTransfersCheck.tsx");
const auth = read("components/AuthProvider.tsx");
const mutations = read("lib/accountMutations.ts");
const prefs = read("components/PreferencesContext.tsx");
const apiSrc = read("lib/api.ts");

check("SpendPage uses the shared miscategorised loader", spend.includes("loadMiscategorisedCount(offset, force)") && !/api\.getMiscategorisedCount/.test(spend));
check("HomeTransfersCheck uses the shared miscategorised loader", transfers.includes("loadMiscategorisedCount(0") && !/api\.getMiscategorisedCount/.test(transfers));
for (const k of ["today", "safeToSpend", "syncStatus", "recentTransactions", "investmentAccounts", "profile"]) {
  check(`HomePage reads ${k} through the endpoint cache`, home.includes(`ENDPOINT.${k}.key`));
}
check("HomePage only the mount effect allows the cache", home.includes("loadData({ allowCache: true })") && (home.match(/allowCache: true/g) || []).length === 1);
check("HomePage explicit refreshes force", home.includes("const force = !allowCache;"));
check("HomePage refetchToday forces", /ENDPOINT\.today\.key, \(\) => api\.getToday\(\), \{ force: true \}/.test(home));
check("SpendPage reads subscription through the endpoint cache", spend.includes("ENDPOINT.subscription.key"));
for (const f of ["components/CashFlowCard.tsx", "components/UpcomingBillsStrip.tsx"]) check(`${f} uses the cashflow cache`, read(f).includes("ENDPOINT.cashflow.key"));
check("OfferCard uses the offers cache", read("components/OfferCard.tsx").includes("ENDPOINT.offers.key"));
check("HomeInsightSpotlight uses the spotlight cache", read("components/HomeInsightSpotlight.tsx").includes("ENDPOINT.spotlight.key"));
check("AuthProvider installs the invalidation bindings", auth.includes('import "@/lib/endpointCacheBindings"'));
check("sign-out / account mutations clear endpoint caches", mutations.includes("invalidateAllEndpoints()") && mutations.includes("invalidateMiscategorisedCount()"));
check("money preference saves clear endpoint caches", prefs.includes("invalidateEndpoint(...TRANSACTIONS_CHANGED_KEYS)"));
check("successful writes clear money endpoints in the api fetch wrapper", apiSrc.includes("isEndpointCacheWrite(input, init)") && apiSrc.includes("invalidateEndpoint(...TRANSACTIONS_CHANGED_KEYS)"));
check("no localStorage persistence in the endpoint cache", !/localStorage/.test(read("lib/endpointCache.ts").replace(/\/\/.*$/gm, "")));
check("push receipt drops the endpoint caches", /addListener\("pushNotificationReceived", \(\) => \{[^}]*invalidateAllEndpoints\(\);/s.test(read("lib/capacitorPush.ts")));
check("push listener does not return a plugin proxy from an async function", !/return\s+PushNotifications\b/.test(read("lib/capacitorPush.ts").split("pushNotificationReceived")[1]?.slice(0, 400) ?? ""));
check("endpoint cache enforces a max age and London-day boundary", /ENDPOINT_MAX_AGE_MS/.test(read("lib/endpointCache.ts")) && read("lib/endpointCache.ts").includes("Europe/London"));

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nAll G425 source checks passed");
