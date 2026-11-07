// A193: bank consent on Android battery saver. Run: npm run -s check:a193-consent-resume
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startConsent, consentStartInFlight } from "../lib/startConsent.ts";
import {
  CONSENT_INTERRUPTED_MESSAGE, PENDING_CONSENT_KEY, PENDING_CONSENT_TTL_MS,
  markPendingConsent, readPendingConsent, resolvePendingConsent,
} from "../lib/pendingConsent.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const mem = () => { const m = new Map(); return {
  getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
let checks = 0;

function harness({ slow = false, fail = false } = {}) {
  const log = []; let n = 0; let release;
  const gate = new Promise((r) => { release = r; });
  const deps = {
    isNative: () => true, rnBridge: () => null,
    link: async (_l, id) => { n += 1; log.push(["link", n]); if (slow) await gate; if (fail) throw new Error("boom");
      return { auth_url: `https://bank.example/consent/${n}`, connection_id: `cst_${n}` }; },
    rememberPending: (id, p) => log.push(["remember", id, p]),
    openBrowser: async (url) => { log.push(["open", url]); },
    navigate: () => {}, toolbarColor: () => "#fff",
  };
  return { log, deps, release };
}

// A double start is refused while the first is in flight: one consent, not two.
{
  const { log, deps, release } = harness({ slow: true });
  const first = startConsent({ providerId: "chase" }, async () => deps);
  assert.equal(consentStartInFlight(), true);
  const second = await startConsent({ providerId: "chase" }, async () => deps);
  assert.equal(second.ok, false);
  assert.equal(second.busy, true);
  release();
  assert.equal((await first).ok, true);
  assert.equal(log.filter((e) => e[0] === "link").length, 1);
  assert.equal(consentStartInFlight(), false);
  checks++;
}
// A retry asks the server for a fresh consent and opens that new URL, never the old one.
{
  const { log, deps } = harness();
  await startConsent({ providerId: "chase" }, async () => deps);
  await startConsent({ providerId: "chase" }, async () => deps);
  const opened = log.filter((e) => e[0] === "open").map((e) => e[1]);
  assert.deepEqual(opened, ["https://bank.example/consent/1", "https://bank.example/consent/2"]);
  assert.deepEqual(log.filter((e) => e[0] === "remember").map((e) => e[1]), ["cst_1", "cst_2"]);
  checks++;
}
// A failed start releases the guard so Try again works.
{
  const { deps } = harness({ fail: true });
  const r = await startConsent({ providerId: "chase" }, async () => deps);
  assert.equal(r.ok, false);
  assert.notEqual(r.busy, true);
  assert.equal(consentStartInFlight(), false);
  checks++;
}

// Pending state survives in storage and the server decides the outcome.
{
  const s = mem();
  markPendingConsent(s, "cst_1", "chase", 1000);
  assert.equal(readPendingConsent(s, 2000).connectionId, "cst_1");
  assert.equal(readPendingConsent(s, 1000 + PENDING_CONSENT_TTL_MS + 1), null);
  assert.equal(s.m.has(PENDING_CONSENT_KEY), false);
  checks++;
}
for (const [server, expected] of [
  [{ connection_id: "cst_1", status: "authorized" }, { kind: "connected", connectionId: "cst_1" }],
  [{ connection_id: "cst_1", status: "pending" }, { kind: "failed", providerId: "chase" }],
  [{ connection_id: "cst_1", status: "canceled" }, { kind: "failed", providerId: "chase" }],
  [{ connection_id: "cst_2", status: "pending" }, { kind: "none" }],
  [{ connection_id: null, status: null }, { kind: "none" }],
]) {
  const s = mem();
  markPendingConsent(s, "cst_1", "chase", 1000);
  assert.deepEqual(await resolvePendingConsent(s, async () => server, 2000), expected);
  assert.equal(s.m.has(PENDING_CONSENT_KEY), false, "marker consumed");
  checks++;
}
{
  const s = mem();
  assert.deepEqual(await resolvePendingConsent(s, async () => { throw new Error("no call"); }), { kind: "none" });
  markPendingConsent(s, "cst_1", "chase", 1000);
  const r = await resolvePendingConsent(s, async () => { throw new Error("offline"); }, 2000);
  assert.deepEqual(r, { kind: "none" });
  assert.equal(s.m.has(PENDING_CONSENT_KEY), true, "kept for the next launch when offline");
  checks++;
}

// Error copy: calm, British, no em dash, no exclamation, offers the remedy.
assert.match(CONSENT_INTERRUPTED_MESSAGE, /battery saver/);
assert.match(CONSENT_INTERRUPTED_MESSAGE, /restricted battery use/);
assert.doesNotMatch(CONSENT_INTERRUPTED_MESSAGE, /[—!]/);
checks++;

// Wiring (source checks): one listener, cold-start launch URL, resume on relaunch, Try again button.
{
  const dl = read("lib/deepLinks.ts");
  assert.match(dl, /if \(registered \|\| typeof window === "undefined"\) return/);
  assert.equal((dl.match(/App\.addListener\("appUrlOpen"/g) ?? []).length, 1);
  assert.match(dl, /App\.getLaunchUrl\(\)/);
  assert.match(dl, /launchAlreadyHandled\(launch\.url\)/);
  const h = read("components/DeepLinkHandler.tsx");
  assert.match(h, /resolvePendingConsent\(window\.localStorage/);
  assert.match(h, /connect=interrupted/);
  assert.match(h, /clearPendingConsent\(window\.localStorage\)/);
  const a = read("app/components/AccountsPage.tsx");
  assert.match(a, /connect === "interrupted"/);
  assert.match(a, />Try again<\/button>/);
  assert.match(a, /retryConsent/);
  const sc = read("lib/startConsent.ts");
  assert.doesNotMatch(sc, /localStorage\.setItem\([^)]*auth_url|let lastAuthUrl|cachedUrl/);
  for (const f of ["components/BankPickerSheet.tsx", "app/components/HomePage.tsx", "app/components/AccountsPage.tsx"]) {
    assert.match(read(f), /busy/, `${f} handles a busy start`);
  }
  checks++;
}
console.log(`a193-consent-resume: ${checks} checks passed`);
