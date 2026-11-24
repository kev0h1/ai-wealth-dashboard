// F28: production consent screen (F23 variant A) sends exactly the user's scope selection.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import OAuthConsentCard from "../app/oauth/consent/OAuthConsentCard.tsx";
import { buildDecisionBody, grantedScopesFor, toggleScope, scopeDisclosure } from "../lib/oauthScopes.ts";

const scopes = [
  { scope: "accounts:read", description: "short a" },
  { scope: "plans:read", description: "short p" },
  { scope: "insights:read", description: "short i" },
];
const requested = scopes.map((s) => s.scope);

// Selection helpers
assert.deepEqual(toggleScope(requested, "plans:read"), ["accounts:read", "insights:read"]);
assert.deepEqual(toggleScope(["accounts:read"], "plans:read"), ["accounts:read", "plans:read"]);
assert.deepEqual(grantedScopesFor(requested, ["insights:read", "accounts:read", "evil:write"]), ["accounts:read", "insights:read"]);
assert.deepEqual(grantedScopesFor(requested, []), []);

// Decision payload: approve names the subset, deny sends none.
assert.deepEqual(buildDecisionBody("r1", true, ["accounts:read"]), { req_id: "r1", approve: true, granted_scopes: ["accounts:read"] });
assert.deepEqual(buildDecisionBody("r1", false, ["accounts:read"]), { req_id: "r1", approve: false });
assert.equal("granted_scopes" in buildDecisionBody("r1", false), false);

// api.decideOAuthRequest posts that payload to /oauth/decision.
globalThis.window ??= { location: { origin: "http://localhost" } };
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), body: JSON.parse(init.body) });
  return { ok: true, json: async () => ({ redirect: "https://x.example/cb" }) };
};
const { api } = await import("../lib/api.ts");
await api.decideOAuthRequest("r9", true, ["plans:read"]);
await api.decideOAuthRequest("r9", false);
assert.ok(calls[0].url.endsWith("/oauth/decision"));
assert.deepEqual(calls[0].body, { req_id: "r9", approve: true, granted_scopes: ["plans:read"] });
assert.deepEqual(calls[1].body, { req_id: "r9", approve: false });

// Disclosure: known scopes use the approved detailed copy; unknown fall back to the API text.
assert.equal(scopeDisclosure("accounts:read", "x").title, "Account information and balances");
assert.deepEqual(scopeDisclosure("future:read", "From the API"), { title: "future:read", description: "From the API" });

// Rendered markup: real API values, all scopes ticked by default, Approve and Deny, no fixtures.
const html = renderToStaticMarkup(h(OAuthConsentCard, {
  clientName: "Claude", redirectHost: "claude.ai", scopes, onApprove() {}, onDeny() {},
}));
assert.equal((html.match(/type="checkbox"/g) || []).length, 3);
assert.equal((html.match(/checked=""/g) || []).length, 3);
assert.match(html, />claude\.ai</);
assert.match(html, />Claude</);
assert.match(html, /Allow selected data/);
assert.match(html, />Deny</);
assert.match(html, /Before you share/);
assert.match(html, /has not been assessed by Sorted or Finexer/);
assert.match(html, /cannot be recalled/);
assert.match(html, /received through Finexer/);
assert.doesNotMatch(html, /Fictional|Northstar|Preview only|Verified host/);
assert.doesNotMatch(html, /violet|red-|from-indigo|bg-gradient/);
assert.doesNotMatch(html, /—/);
// Variant A fix: no rules directly above "Before you share" (the permissions list keeps only its top rule).
const beforeWarning = html.slice(0, html.indexOf("data-mcp-warning"));
assert.equal((beforeWarning.match(/last:border-b-0/g) || []).length, 3);
assert.match(html.slice(html.indexOf("data-mcp-warning") - 40, html.indexOf("data-mcp-warning")), /<section/);

// Busy state disables everything.
const busy = renderToStaticMarkup(h(OAuthConsentCard, { clientName: "Claude", redirectHost: "claude.ai", scopes, onApprove() {}, onDeny() {}, busy: true }));
assert.equal((busy.match(/disabled=""/g) || []).length, 5);

// Client wires the card's selection into the decision, and the preview is gone.
const client = readFileSync(new URL("../app/oauth/consent/OAuthConsentClient.tsx", import.meta.url), "utf8");
assert.match(client, /onApprove=\{\(granted\) => decide\(true, granted\)\}/);
console.log("f28 consent scopes ok");
