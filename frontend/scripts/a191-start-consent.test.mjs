// A191: reconnect launches the consent through the same code as the bank picker.
// Run: npm run -s check:a191-start-consent
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runConsent, consentErrorMessage } from "../lib/startConsent.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
class ApiError extends Error {
  constructor(status, detail, message) { super(message); this.name = "ApiError"; this.status = status; this.detail = detail; }
}

function harness({ native = false, rn = false, linkError = null } = {}) {
  const log = [];
  const deps = {
    isNative: () => native,
    rnBridge: () => (rn ? { postMessage: (s) => log.push(["post", s]) } : null),
    link: async (legacy, id, n) => { log.push(["link", legacy, id, n]); if (linkError) throw linkError; return { auth_url: "https://bank.example/consent" }; },
    openBrowser: async (url, colour) => { log.push(["browser", url, colour]); },
    navigate: (url) => log.push(["navigate", url]),
    toolbarColor: () => "#f0f2f7",
  };
  return { log, deps };
}
const opts = (log, extra = {}) => ({
  providerId: "chase", beforeLaunch: () => log.push(["before"]), onConnecting: () => log.push(["connecting"]),
  onHandedOff: () => log.push(["handed"]), ...extra,
});
let checks = 0;

// Native: native flag true, in-app browser, never a location change.
{
  const { log, deps } = harness({ native: true });
  const r = await runConsent(opts(log), deps);
  assert.deepEqual(r, { ok: true, mode: "browser" });
  assert.deepEqual(log, [["link", false, "chase", true], ["before"], ["browser", "https://bank.example/consent", "#f0f2f7"]]);
  checks++;
}
// Web: native false, location navigation.
{
  const { log, deps } = harness();
  const r = await runConsent(opts(log), deps);
  assert.equal(r.mode, "location");
  assert.deepEqual(log, [["link", false, "chase", false], ["before"], ["connecting"], ["navigate", "https://bank.example/consent"]]);
  checks++;
}
// React Native WebView: open_external postMessage.
{
  const { log, deps } = harness({ rn: true });
  const r = await runConsent(opts(log), deps);
  assert.equal(r.mode, "rn");
  assert.deepEqual(log[0], ["link", false, "chase", false]);
  assert.deepEqual(JSON.parse(log.find((e) => e[0] === "post")[1]), { type: "open_external", url: "https://bank.example/consent" });
  assert.equal(log.at(-1)[0], "handed");
  checks++;
}
// Legacy provider passes through.
{
  const { log, deps } = harness({ native: true });
  await runConsent(opts(log, { legacy: true }), deps);
  assert.deepEqual(log[0], ["link", true, "chase", true]);
  checks++;
}
// A178 error mapping, and nothing launches on failure.
for (const [err, message, rejected] of [
  [new ApiError(422, { code: "BANK_PROVIDER_REJECTED" }, "That bank is not available."), "That bank is not available.", true],
  [new ApiError(422, { code: "OTHER" }, "Nope."), "Nope.", false],
  [new ApiError(502, null, "Bank link failed, try again."), "Bank link failed, try again.", false],
  [new ApiError(402, null, "Plan limit."), "Plan limit.", false],
  [new ApiError(500, null, "boom"), "Failed to connect. Please try again.", false],
  [new Error("network"), "Failed to connect. Please try again.", false],
]) {
  const { log, deps } = harness({ native: true, linkError: err });
  const r = await runConsent(opts(log), deps);
  assert.deepEqual(r, { ok: false, message, rejected });
  assert.deepEqual(log, [["link", false, "chase", true]]);
  assert.deepEqual(consentErrorMessage(err), { message, rejected });
  checks++;
}

// Source guards: both reconnect handlers use the helper and never navigate to auth_url themselves.
for (const f of ["app/components/HomePage.tsx", "app/components/AccountsPage.tsx"]) {
  const src = read(f);
  const start = src.indexOf("async function handleReconnect");
  assert.ok(start > 0, f);
  const body = src.slice(start, src.indexOf("\n  }\n", start)).replace(/\/\/.*$/gm, "");
  assert.match(body, /startConsent\(/, f);
  assert.doesNotMatch(body, /auth_url|location\.(assign|href)|finexerConnectLink\(|legacyBankConnectLink\(/, f);
  assert.match(body, /!legacy && !providerId/, `${f} keeps the picker fallback`);
  checks++;
}
assert.match(read("app/components/AccountsPage.tsx"), /beforeLaunch[\s\S]{0,200}reconnect_expected/);
// The picker uses it too, and the app-level listener that handles the return is mounted outside any sheet.
const picker = read("components/BankPickerSheet.tsx");
assert.match(picker, /startConsent\(/);
assert.doesNotMatch(picker, /finexerConnectLink|Browser\.open/);
assert.match(read("app/Providers.tsx"), /<DeepLinkHandler \/>/);
checks++;

console.log(`a191-start-consent: ${checks} checks passed`);
