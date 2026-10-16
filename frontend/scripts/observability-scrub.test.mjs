// E6: the web and app Sentry scrubber (lib/observability.ts) removes every
// class of personal and financial data from a sample event and breadcrumb.
// No Sentry import, no network: the scrubber is plain functions.
// Run: npm run -s check:observability-scrub
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FILTERED, MAX_TRACES_SAMPLE_RATE, clampTracesSampleRate, resolveEnvironment, scrubBreadcrumb, scrubEvent, scrubString,
} from "../lib/observability.ts";

const RAW = {
  email: "kevin.maingi12@gmail.com",
  bearer: "Bearer abcdef1234567890abcdef",
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlMTIz",
  card: "4929 1234 5678 9012",
  sort: "20-12-34",
  acct: "12345678",
  iban: "GB29 NWBK 6016 1331 9268 19",
  amount: "£1,234.56",
  neg: "−£42.10",
};

// Every string class.
for (const [name, value] of Object.entries(RAW)) {
  assert.ok(!scrubString(`prefix ${value} suffix`).includes(value), `string class survived: ${name}`);
}
assert.equal(scrubString("GET https://x.test/a/b?merchant=TESCO#f ok"), "GET https://x.test/a/b ok");

const sha = "9f8e7d6c5b4a3928a706f5e4d3c2b1a0b9c8d7e6";
assert.equal(scrubString(sha), sha, "a 40-char release SHA must survive");

const event = {
  event_id: "a".repeat(32),
  release: sha,
  environment: "uat",
  server_name: "host",
  user: { id: "fcdec6df4d44dbc6", email: RAW.email, username: "Kevin Maingi", ip_address: "1.2.3.4" },
  request: {
    method: "POST",
    url: "https://x.test/spend?merchant=TESCO&token=abc",
    query_string: "merchant=TESCO",
    cookies: { session: "s3cret" },
    data: { amount: 12.5, merchant: "TESCO" },
    headers: { Authorization: RAW.bearer, Cookie: "a=b", "Content-Type": "application/json", "X-Api-Key": "k", Referer: "https://x.test/?e=1" },
  },
  exception: { values: [{
    type: "Error",
    value: `bad row for ${RAW.email} paid ${RAW.amount} card ${RAW.card} ${RAW.bearer}`,
    stacktrace: { frames: [{ filename: "a.js", function: "f", lineno: 3, vars: { merchant: "TESCO" }, context_line: "x = 1" }] },
  }] },
  extra: { merchant_name: "TESCO", balance: 100, note: `sort ${RAW.sort} acct ${RAW.acct} iban ${RAW.iban}` },
  tags: { account_number: "12345678", route: "/spend" },
  transaction: "/spend?tab=1",
  breadcrumbs: [
    { category: "console", message: "log TESCO" },
    { category: "ui.input", message: "input" },
    { category: "fetch", message: `GET https://x.test/a?email=${RAW.email}`, data: { url: "https://x.test/a?email=k@x.com", body: "secret", status_code: 200, method: "GET" } },
    { category: "navigation", data: { from: "/a?x=1", to: "/spend?merchant=TESCO" } },
  ],
};

const out = scrubEvent(event, {});
const blob = JSON.stringify(out);
for (const needle of [
  "kevin.maingi12", "Kevin Maingi", "TESCO", "s3cret", "abcdef1234567890", "4929", "20-12-34", "12345678", "NWBK",
  "1,234.56", "1.2.3.4", "k@x.com", "x = 1", "host", "merchant=", "token=abc", "?tab=1",
]) assert.ok(!blob.includes(needle), `event leaked: ${needle}`);

assert.deepEqual(out.user, { id: "fcdec6df4d44dbc6" }, "only the hashed id survives");
assert.equal(out.request.url, "https://x.test/spend");
assert.deepEqual(Object.keys(out.request).sort(), ["headers", "method", "url"]);
assert.deepEqual(Object.keys(out.request.headers), ["Content-Type"]);
assert.equal(out.extra.balance, FILTERED);
assert.equal(out.extra.merchant_name, FILTERED);
assert.equal(out.tags.route, "/spend");
assert.equal(out.release, sha);
assert.equal(out.transaction, "/spend");
assert.equal("vars" in out.exception.values[0].stacktrace.frames[0], false);
assert.equal(out.breadcrumbs.length, 2, "console and ui.input breadcrumbs dropped");
assert.equal(out.breadcrumbs[0].data.url, "https://x.test/a");
assert.equal("body" in out.breadcrumbs[0].data, false);
assert.equal(out.breadcrumbs[0].data.status_code, 200);
assert.equal(out.breadcrumbs[1].data.to, "/spend");

// A user id that is not a 16-hex hash is dropped, never passed through.
assert.equal("user" in scrubEvent({ user: { id: "kevin@example.com" } }, {}), false);
assert.equal("user" in scrubEvent({ user: { email: RAW.email } }, {}), false);

// Breadcrumb hook on its own.
assert.equal(scrubBreadcrumb({ category: "console", message: "x" }), null);
const crumb = scrubBreadcrumb({ category: "xhr", message: `paid ${RAW.amount}`, data: { authorization: "x", ok: 1, body: "b" } });
assert.ok(!JSON.stringify(crumb).includes(RAW.amount));
assert.equal(crumb.data.authorization, FILTERED);
assert.equal(crumb.data.ok, 1);
assert.equal(scrubBreadcrumb(null), null);

// Spans keep timing, lose text.
assert.deepEqual(
  scrubEvent({ type: "transaction", spans: [{ op: "http", description: "GET /x?a=1", data: { a: 1 }, start_timestamp: 1 }] }, {}).spans,
  [{ op: "http", start_timestamp: 1 }],
);

// Expected failures are not reported.
assert.equal(scrubEvent({ exception: { values: [{ value: "Failed to fetch" }] } }, {}), null);
assert.equal(scrubEvent({ message: "x" }, { originalException: { status: 404 } }), null);
assert.notEqual(scrubEvent({ message: "x" }, { originalException: { status: 500 } }), null);

// Configuration: traces never above 0.1, environment is uat unless production.
assert.equal(MAX_TRACES_SAMPLE_RATE, 0.1);
assert.equal(clampTracesSampleRate("1"), 0.1);
assert.equal(clampTracesSampleRate("0.05"), 0.05);
assert.equal(clampTracesSampleRate(undefined), 0.1);
assert.equal(clampTracesSampleRate("junk"), 0.1);
assert.equal(clampTracesSampleRate("-3"), 0);
assert.equal(resolveEnvironment("production"), "production");
assert.equal(resolveEnvironment("staging"), "uat");
assert.equal(resolveEnvironment(undefined), "uat");

// Wiring invariants (source level, so they hold without a DSN or a build).
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const client = read("instrumentation-client.ts");
assert.match(client, /if \(dsn\)/, "client init must be gated on the DSN");
assert.ok(!/replayIntegration|replaysSessionSampleRate|replaysOnErrorSampleRate/.test(client + read("sentry.server.config.ts") + read("sentry.edge.config.ts")), "session replay must stay off");
assert.ok(!/tunnelRoute/.test(read("next.config.ts")), "no Sentry tunnel");
assert.match(read("next.config.ts"), /disable: !sentryAuthToken/, "source map upload only with SENTRY_AUTH_TOKEN");
for (const f of ["instrumentation-client.ts", "sentry.server.config.ts", "sentry.edge.config.ts"]) {
  const src = read(f);
  assert.match(src, /sendDefaultPii: false/, `${f}: sendDefaultPii off`);
  assert.match(src, /beforeSend: scrubEvent/, `${f}: beforeSend scrubbing`);
  assert.match(src, /beforeBreadcrumb: scrubBreadcrumb/, `${f}: beforeBreadcrumb scrubbing`);
}

// Free-text keys (E6 hardening) are filtered in extra and in breadcrumb data.
const free = scrubEvent({ extra: { note: "paid TESCO", counterparty: "TESCO", prompt: "p", title: "t" },
  breadcrumbs: [{ category: "fetch", data: { narrative: "TESCO", text: "x", content: "y", notes: "z" } }] }, {});
assert.ok(!JSON.stringify(free).includes("TESCO"));
assert.equal(free.extra.note, FILTERED);
assert.equal(free.breadcrumbs[0].data.narrative, FILTERED);

// Finding 2/3 (frontend): a db error text and an API error carrying a merchant are reduced.
const dup = 'E11000 duplicate key error collection: wealth.rules dup key: { merchant: "Greggs" }';
assert.ok(!scrubString(dup).includes("Greggs"), "dup key text must be cut");
const apiEv = scrubEvent(
  { exception: { values: [{ type: "ApiError", value: 'Category "Greggs" 4.50 not found' }] } },
  { originalException: { name: "ApiError", status: 500 } },
);
assert.equal(apiEv.exception.values[0].value, "ApiError (status 500)");
assert.ok(!JSON.stringify(apiEv).includes("Greggs"));

// Finding 4: bare amounts after money words.
for (const t of ["amount 250", "balance: 1,234.56", "Total=99", "paid -12.5", "price \u221220"]) {
  const o = scrubString(t);
  assert.ok(o.includes("[amount]") && !/\d/.test(o), `bare amount survived: ${t} -> ${o}`);
}

// Finding 5: the Capacitor init bounds what the native layer collects.
for (const opt of [
  "enableNativeCrashHandling: true", "enableNdkScopeSync: false", "enableAutoSessionTracking: false",
  "enableCaptureFailedRequests: false", "enableAutoPerformanceTracing: false", "enableAppHangTracking: false",
  "attachThreads: false", "attachScreenshot: false",
]) assert.ok(client.includes(opt), `native option missing: ${opt}`);

console.log("observability-scrub: ok");
