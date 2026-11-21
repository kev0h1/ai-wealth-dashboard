import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FirstSyncCard from "../components/FirstSyncCard.tsx";
import { hasHomeConnectionEvidence } from "../lib/homeConnectionState.ts";

const connection = { provider: "finexer", bank: "Barclays Personal", phase: "fetching" };
for (const surface of ["home", "spend", "upcoming"]) {
  for (const state of ["syncing", "stalled", "failed"]) {
    for (const phase of ["fetching", "computing"]) {
      const html = renderToStaticMarkup(React.createElement(FirstSyncCard, {
        surface, state, connections: [{ ...connection, phase }], onRetry() {}, onConnect() {},
      }));
      assert.match(html, /Barclays Personal connected/);
      assert.match(html, /No figure yet/);
      assert.match(html, /Fetching transactions/);
      assert.match(html, /Working out your figures/);
      assert.doesNotMatch(html, /£|Nothing more expected|no spending to compare|—/);
      assert.doesNotMatch(html, /(?:bg|text|border)-(?:red|rose)-|role="alert"/);
      if (surface === "spend") assert.match(html, /show your spending once/);
      if (surface === "upcoming") assert.match(html, /show what is expected once/);
      if (phase === "computing") assert.match(html, /Fetching transactions<\/span><span[^>]*>Done/);
      if (state === "failed") assert.match(html, /Try again/);
      if (state === "stalled") assert.doesNotMatch(html, /animate-spin/, "a stalled sync has no endless spinner");
      if (state === "failed" && phase === "computing") assert.match(html, /transactions arrived/);
    }
  }
}

const empty = { status: null, bankConnectionCount: 0, recentCount: 0, pendingCount: 0 };
assert.equal(hasHomeConnectionEvidence(empty), false);
assert.equal(hasHomeConnectionEvidence({ ...empty, status: { state: "idle", first_sync: true, has_connections: false, connections: [] } }), false);
assert.equal(hasHomeConnectionEvidence({ ...empty, status: { state: "idle", first_sync: false, has_connections: true, connections: [] } }), true, "settled connections do not appear in progress rows");
assert.equal(hasHomeConnectionEvidence({ ...empty, status: { state: "syncing", first_sync: true, connections: [connection] } }), true, "older server's pending rows still establish a connection");
for (const key of ["bankConnectionCount", "recentCount", "pendingCount"]) {
  assert.equal(hasHomeConnectionEvidence({ ...empty, [key]: 1 }), true, key);
}
console.log("g485 first-sync surfaces and Home connection evidence: ok");
