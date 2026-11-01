// A182: the 90-day reconfirmation prompt wording and show/hide rule, plus the
// connection-row and consent-failure copy.
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  formatHistoryRequested,
  RECONFIRM_BUTTON, RECONFIRM_ERROR, reconfirmQuestion, isReconfirmDismissed,
  pickReconfirmConnection, reconfirmDismissKey, formatNextReconfirm, connectionNotes,
} from "../lib/reconfirm.ts";
import ReconfirmPrompt from "../components/ReconfirmPrompt.tsx";

assert.equal(reconfirmQuestion("Barclays"), "Still OK for Sorted to read your Barclays data?");
assert.equal(reconfirmQuestion(undefined), "Still OK for Sorted to read your bank data?");
assert.equal(RECONFIRM_BUTTON, "Yes, carry on");
assert.equal(RECONFIRM_ERROR, "We could not confirm just now. Try again later.");

const now = new Date("2026-11-01T09:00:00Z");
const due = "2026-11-10T09:00:00Z";
const conn = (o = {}) => ({ connection_id: "c1", provider: "finexer", status: "authorized", expires_at: null, accounts: 1, reconfirm_prompt: true, next_reconfirm_by: due, ...o });

assert.equal(pickReconfirmConnection([conn()], () => null, now)?.connection_id, "c1");
assert.equal(pickReconfirmConnection([conn({ reconfirm_prompt: false })], () => null, now), null);
assert.equal(pickReconfirmConnection([conn({ provider: "truelayer" })], () => null, now), null);
assert.equal(pickReconfirmConnection([conn({ status: "expired" })], () => null, now), null);

// Dismissed until the due day; a new due date is a new prompt.
assert.equal(isReconfirmDismissed(due, due, now), true);
assert.equal(isReconfirmDismissed(due, due, new Date("2026-11-10T09:00:01Z")), false);
assert.equal(isReconfirmDismissed("2026-08-01T09:00:00Z", due, now), false);
assert.equal(pickReconfirmConnection([conn()], (k) => (k === reconfirmDismissKey("c1") ? due : null), now), null);

assert.equal(formatNextReconfirm("2027-01-30T00:00:00Z"), "Next reconfirmation 30 January 2027");
assert.equal(formatNextReconfirm(null), null);
assert.deepEqual(connectionNotes(conn({ next_reconfirm_by: "2027-01-30T00:00:00Z" })), ["Next reconfirmation 30 January 2027"]);
assert.deepEqual(connectionNotes(conn({ status: "expired" })), []);
assert.deepEqual(connectionNotes(undefined), []);

assert.equal(formatHistoryRequested("2025-11-01"), "History requested from 1 November 2025");
assert.equal(formatHistoryRequested(null), null);
assert.equal(formatHistoryRequested("nonsense"), null);
assert.deepEqual(
  connectionNotes(conn({ next_reconfirm_by: "2027-01-30T00:00:00Z", history_requested_from: "2025-11-01" })),
  ["Next reconfirmation 30 January 2027", "History requested from 1 November 2025"],
);

// Rendered prompt: the exact question and button, no red, no em dash.
globalThis.window = { localStorage: { getItem: () => null, setItem() {} } };
const html = renderToStaticMarkup(h(ReconfirmPrompt, { connections: [conn()], bankNameFor: () => "Barclays" }));
const text = html.replace(/<[^>]+>/g, "|");
assert.match(text, /Still OK for Sorted to read your Barclays data\?/);
assert.match(text, /Yes, carry on/);
assert.doesNotMatch(html, /red-|amber-|—/);
assert.equal(renderToStaticMarkup(h(ReconfirmPrompt, { connections: [conn({ reconfirm_prompt: false })], bankNameFor: () => "Barclays" })), "");
console.log("a182-reconfirm ok");

// Part 4: the reconnect strip shows the plain reason when there is one.
import ReconnectStrip from "../components/ReconnectStrip.tsx";
const reason = "Your bank ended this connection. Reconnect to give access again.";
const strip = renderToStaticMarkup(h(ReconnectStrip, { providers: [{ provider: "Barclays", reason }], onReconnect() {} }));
assert.match(strip.replace(/<[^>]+>/g, "|"), /Barclays needs reconnecting\|?.*Your bank ended this connection\. Reconnect to give access again\./);
const plain = renderToStaticMarkup(h(ReconnectStrip, { providers: [{ provider: "Barclays" }], onReconnect() {} }));
assert.doesNotMatch(plain, /Your bank/);
console.log("a182 reconnect reason ok");

// Gate off: the server never sets reconfirm_prompt, so nothing is picked or rendered,
// while the date line stays live (information only).
const off = conn({ reconfirm_prompt: false, next_reconfirm_by: "2027-01-30T00:00:00Z" });
assert.equal(pickReconfirmConnection([off], () => null, now), null);
assert.equal(renderToStaticMarkup(h(ReconfirmPrompt, { connections: [off], bankNameFor: () => "Barclays" })), "");
assert.deepEqual(connectionNotes(off), ["Next reconfirmation 30 January 2027"]);
// Home fetches /connections only when needed.
import { readFileSync } from "node:fs";
const home = readFileSync(new URL("../app/components/HomePage.tsx", import.meta.url), "utf8");
assert.match(home, /needsConnections/);
assert.doesNotMatch(home, /useEffect\(\(\) => \{\s*api\.connections\(\)/);
console.log("a182 gate ok");
