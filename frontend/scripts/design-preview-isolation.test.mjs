import assert from "node:assert/strict";
import { api, gatedFetch, authHeaders, setUnauthorizedHandler } from "../lib/api";
import { setAppLocked } from "../lib/appLock";
import { previewAction } from "../app/design/spend-live/previewAction";

// All requests stay in this process, including the product-route controls.
const previousWindow = globalThis.window;
const previousFetch = globalThis.fetch;
const requests = [];
let unauthorised = 0;
globalThis.window = {
  location: { pathname: "/design/spend-live" },
  localStorage: { getItem: () => "synthetic-review-session" },
};
globalThis.fetch = async (input, init) => {
  requests.push({ input, init });
  return { ok: true, status: 200, json: async () => [] };
};
setUnauthorizedHandler(() => { unauthorised += 1; });

try {
  assert.equal(authHeaders().Authorization, "Bearer synthetic-review-session");
  const actions = [
    () => api.recordTrendIntent("Shopping", "one_off"),
    () => api.createCheckpoint("Shopping", 100),
    () => api.cancelCheckpoint("synthetic-checkpoint"),
    () => api.transactionsSearch({ page: 1, page_size: 20 }),
    () => api.similarTransactions("synthetic-transaction", "all"),
    // Product components imported by previews use these same transports.
    () => api.patchTransaction("synthetic-transaction", { category: "Groceries" }),
    () => api.addRule("Preview rule", "synthetic-merchant", "Groceries"),
  ];
  for (const pathname of ["/design", "/design/", "/design/spend-live", "/design/some-preview"]) {
    window.location.pathname = pathname;
    for (const action of actions) {
      await assert.rejects(action, /Preview only/);
    }
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      await assert.rejects(gatedFetch("/api/preferences", { method }), /Preview only/);
    }
    // Design isolation also covers the biometric gate's exemptions.
    setAppLocked(true);
    await assert.rejects(gatedFetch("/api/auth/logout", { method: "POST" }), /Preview only/);
    await assert.rejects(gatedFetch("/api/auth/session/validate", { method: "POST" }), /Preview only/);
    setAppLocked(false);
  }
  assert.equal(requests.length, 0, "preview reads and writes must never reach fetch");
  assert.equal(unauthorised, 0, "local preview refusals must not sign the visitor out");

  await assert.rejects(previewAction(), /Preview only/);
  // Call-time checks allow navigation back to the product without a reload,
  // and do not over-match other path segments or change SSR behaviour.
  for (const pathname of ["/spend", "/transactions", "/designer", "/design-system"]) {
    window.location.pathname = pathname;
    await api.recordTrendIntent("Shopping", "one_off");
  }
  assert.equal(requests.length, 4);
  assert.equal(requests[0].init.headers.Authorization, "Bearer synthetic-review-session");
  delete globalThis.window;
  await gatedFetch("/api/health");
  assert.equal(requests.length, 5);
} finally {
  globalThis.fetch = previousFetch;
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  setAppLocked(false);
  setUnauthorizedHandler(null);
}

console.log("design-preview-isolation OK (zero preview requests, product navigation)");
