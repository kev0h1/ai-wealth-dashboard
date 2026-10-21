// E9: raw props through the Recent webhooks block. Counts and rows render,
// failed uses the existing warning tone (never red), and no currency or id
// shaped value can appear in the markup.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RecentWebhooks, { RECENT_WEBHOOKS_TITLE } from "../app/ops/health/RecentWebhooks.tsx";

const data = {
  recent_webhooks: [
    { received_at: "2026-10-21T11:30:00+00:00", provider: "finexer", event_type: "bank_account.synced", outcome: "queued" },
    { received_at: "2026-10-21T11:00:00+00:00", provider: "stripe", event_type: "invoice.paid", outcome: "processed" },
    { received_at: "2026-10-21T10:00:00+00:00", provider: "finexer", event_type: "consent.authorized", outcome: "skipped", reason: "consent_not_found" },
    { received_at: "2026-07-01T10:00:00+00:00", provider: "google", event_type: "other", outcome: "failed", reason: "unfinished" },
  ],
  webhook_counts_24h: { finexer: { queued: 12, skipped: 1, failed: 0 }, stripe: { processed: 3 }, apple: {} },
  counts_truncated: false,
};
const html = renderToStaticMarkup(h(RecentWebhooks, { data }));
const text = html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

assert.equal(RECENT_WEBHOOKS_TITLE, "Recent webhooks");
assert.equal((html.match(/<li /g) ?? []).length, 2 + 4, "two provider count lines plus four rows");
assert.match(text, /Finexer 1 skipped, 12 queued/);
assert.doesNotMatch(text, /0 failed/, "zero counts are not shown");
assert.doesNotMatch(text, /Apple/, "providers with no non-zero counts are hidden");
assert.match(text, /Stripe 3 processed/);
assert.match(text, /skipped, consent not found/);
assert.match(text, /failed, unfinished/);
assert.match(text, /21 Oct, 12:30/, "UK local time (BST)");
assert.match(text, /1 Jul, 11:00/, "UK local time in summer");
assert.match(text, /Finexer, bank_account\.synced/);
assert.match(html, /text-amber-700[^"]*"[^>]*>\s*failed/, "failed uses the warning tone");
assert.doesNotMatch(html, /red-|bg-amber|bg-red/, "no red and no filled warning");
assert.doesNotMatch(html, /£/, "no currency");
assert.doesNotMatch(html, /[a-z]+_[a-z0-9]{8,}|@|https?:/, "no ids, emails or urls");

const empty = renderToStaticMarkup(h(RecentWebhooks, { data: { recent_webhooks: [], webhook_counts_24h: {}, counts_truncated: false } }));
assert.match(empty, /Nothing received in the last 24 hours/);
assert.match(empty, /No webhooks recorded yet/);

const src = readFileSync(new URL("../app/ops/health/RecentWebhooks.tsx", import.meta.url), "utf8");
assert.ok(!/[—!]/.test(src.replace(/\{!|!==|!=|!\w|\?!|!\)|!\./g, "")), "no em dash or exclamation mark in copy");
const page = readFileSync(new URL("../app/ops/health/page.tsx", import.meta.url), "utf8");
assert.match(page, /api\.getOpsRecentWebhooks/);
assert.match(page, /<RecentWebhooks data=\{webhooks\.data\} \/>/);
console.log("e9-recent-webhooks: ok");
