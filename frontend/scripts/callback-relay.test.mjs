// A68: the Next bank-callback routes are transparent relays of the backend decision.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { relayBackendCallback } from "../lib/callbackRelay.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = "https://wealth.example";
const run = (fetchImpl) =>
  relayBackendCallback({ provider: "finexer", connectionId: "cst_1", backendUrl: "http://b/x", publicBase: BASE, fetchImpl });

// 303 -> 303 with the same Location.
let seen;
let r = await run(async (url, init) => {
  seen = init;
  return new Response(null, { status: 303, headers: { location: `${BASE}/accounts?syncing=1&connection=cst_1` } });
});
assert.equal(seen.redirect, "manual");
assert.equal(r.status, 303);
assert.equal(r.headers.get("location"), `${BASE}/accounts?syncing=1&connection=cst_1`);

// Origin rewritten to the public host, path and query kept.
r = await run(async () => new Response(null, { status: 303, headers: { location: "https://other.host/accounts?connect=cancelled" } }));
assert.equal(r.headers.get("location"), `${BASE}/accounts?connect=cancelled`);

// 200 HTML + CSP -> same body and CSP, nothing else.
const CSP = "default-src 'none'; style-src 'sha256-a'; script-src 'sha256-b'";
r = await run(async () => new Response("<html>native</html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP, "x-secret": "no" } }));
assert.equal(r.status, 200);
assert.equal(await r.text(), "<html>native</html>");
assert.equal(r.headers.get("content-security-policy"), CSP);
assert.equal(r.headers.get("x-secret"), null);
assert.equal(r.headers.get("content-type"), "text/html; charset=utf-8");

// 500 and thrown fetch -> 502 error page with a two-hash CSP.
for (const impl of [async () => new Response("boom", { status: 500 }), async () => { throw new Error("down"); }]) {
  r = await run(impl);
  assert.equal(r.status, 502);
  const body = await r.text();
  assert.match(body, /Connection didn’t complete/);
  assert.match(body, /wealthdash:\/\/auth-complete\?provider=finexer&connection=cst_1&status=error/);
  const csp = r.headers.get("content-security-policy");
  assert.equal((csp.match(/'sha256-/g) || []).length, 2, csp);
}

// Routes: MOBILE_EXPORT 204 and source guards.
process.env.MOBILE_EXPORT = "1";
const fx = await import("../app/auth/finexer/callback/route.ts").catch(() => null);
if (fx) assert.equal((await fx.GET(new Request("http://x/?a=1"))).status, 204);
delete process.env.MOBILE_EXPORT;
for (const p of ["finexer", "truelayer"]) {
  const src = readFileSync(path.join(here, "..", "app", "auth", p, "callback", "route.ts"), "utf8");
  assert.ok(src.includes("relayBackendCallback("), p);
  assert.ok(src.includes('process.env.MOBILE_EXPORT === "1"'), p);
  assert.ok(!/user-agent/i.test(src), p);
}
assert.ok(!existsSync(path.join(here, "..", "app", "auth", "returnToApp.ts")));

console.log("check:callback-relay ok");
