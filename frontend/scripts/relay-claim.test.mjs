// D9: the Hide My Email relay claim must be REACHABLE from the refusal the
// backend sends. Pins (1) the refusal decoding, (2) that nativeAuth turns a
// RELAY_INVITE_CLAIM refusal into a "relay_claim" result, (3) that LoginScreen
// renders RelayClaimScreen for that result, and (4) the screen's markup.
//
// Run: npm run -s check:relay-claim

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { classifyAppleRefusal, classifyVerifyStatus } from "../lib/relayClaim.ts";
import RelayClaimScreen from "../components/RelayClaimScreen.tsx";

// 1. Refusal decoding switches on the stable code only.
assert.deepEqual(classifyAppleRefusal(403, { detail: { code: "INVITE_ONLY" } }), { kind: "invite_only" });
assert.deepEqual(
  classifyAppleRefusal(403, { detail: { code: "RELAY_INVITE_CLAIM", claim_token: "tok", link_existing_prompt: "p" } }),
  { kind: "relay_claim", claimToken: "tok", prompt: "p" },
);
assert.equal(classifyAppleRefusal(403, { detail: { code: "RELAY_INVITE_CLAIM" } }), null, "no token, no claim");
assert.equal(classifyAppleRefusal(403, { detail: "Forbidden" }), null);
assert.equal(classifyAppleRefusal(500, { detail: { code: "INVITE_ONLY" } }), null);
assert.equal(classifyAppleRefusal(403, null), null);
assert.equal(classifyVerifyStatus(200), "ok");
assert.equal(classifyVerifyStatus(401), "invalid");
assert.equal(classifyVerifyStatus(429), "locked");
assert.equal(classifyVerifyStatus(500), "failed");

// 2 and 3. Wiring, so a refusal never falls through to the generic failure.
const native = readFileSync(new URL("../lib/nativeAuth.ts", import.meta.url), "utf8");
assert.match(native, /classifyAppleRefusal\(res\.status, body\)/);
assert.match(native, /return "relay_claim"/);
assert.match(native, /\/auth\/apple\/relay|RELAY_SEND_CODE_PATH/);
const login = readFileSync(new URL("../components/LoginScreen.tsx", import.meta.url), "utf8");
assert.match(login, /result === "relay_claim"/);
assert.match(login, /<RelayClaimScreen/);
assert.match(login, /onVerified=/);

// 4. Screen markup: email field, send action, path-1 prompt, way back; no
// em dashes or exclamation marks in copy.
const html = renderToStaticMarkup(
  React.createElement(RelayClaimScreen, {
    prompt: "Already using Sorted with Google? Sign in with that and add Apple from Settings.",
    onSend: async () => "sent", onVerify: async () => "ok", onVerified: () => {}, onBack: () => {},
  }),
);
assert.match(html, /Invited email address/);
assert.match(html, /Send me a code/);
assert.match(html, /add Apple from Settings/);
assert.match(html, /Back to sign in/);
assert.ok(!html.includes("—") && !html.includes("!"), "copy rules");

console.log("relay-claim: all checks passed");
