// E12: pins the owner-only People page. It must be gated like /ops/go-live
// (owner 403 handled, no nav), keep the four filters, make a remove require
// the typed email, use red only on that destructive button, and carry no em
// dashes in its copy.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { FILTERS, WORDING, ACTION_LABELS, emailMatches, filterPeople, sortPeople, counts, revokeMessage, removeMessage } from "../app/ops/people/people.ts";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const page = read("../app/ops/people/page.tsx");
const helpers = read("../app/ops/people/people.ts");
const apiSrc = read("../lib/api.ts");
const goLive = read("../app/ops/go-live/page.tsx");
const exempt = read("../lib/navExemptRoutes.ts");

// Owner-gated like go-live: a 403 shows the owner-only line, nothing else renders.
assert.match(page, /e instanceof ApiError && e\.status === 403/, "403 is handled");
assert.match(page, /setForbidden\(true\)/);
assert.match(page, /WORDING\.forbidden/);
assert.equal(WORDING.forbidden, "This page is for the account owner.");
assert.match(exempt, /path: "\/ops\/people"/, "no primary nav on the owner page");
assert.match(goLive, /href="\/ops\/people"/, "go-live links to the page");
assert.ok(!/AllowlistSection/.test(goLive), "the old allowlist section is replaced by the link");

// Backend routes the page calls.
for (const route of ["`/ops/people${cursor ?", "?cursor=", '"/ops/people/invite"', "/revoke`", "/restore`", "/erase`"]) {
  assert.ok(apiSrc.includes(route), `api.ts has ${route}`);
}
assert.match(apiSrc, /confirm_email: confirmEmail/);

// The four filters, in order.
assert.deepEqual(FILTERS.map((f) => f.key), ["active", "revoked", "no_access", "signed_up", "never_signed_up"]);
assert.deepEqual(FILTERS.map((f) => f.label), ["Active", "Revoked", "No access", "Signed up", "Never signed up"]);
assert.match(page, /FILTERS\.map/);
assert.match(page, /aria-pressed=\{on\}/);

const person = (o) => ({
  id: o.email, email: o.email, owner: false, allowlist_status: "invited", access: "allowed", source: "invite", invited_at: null,
  signed_up: false, signed_up_at: null, last_active_at: null, sign_in_method: null, plan: null, plan_status: null,
  trial_ends_at: null, on_trial: false, banks_connected: null, accounts: null, last_sync: null,
  penny_messages_this_month: null, ...o,
});
const people = [
  person({ email: "owner@example.com", owner: true, allowlist_status: "none", access: "owner", source: "owner", signed_up: true }),
  person({ email: "a@example.com", signed_up: true, last_active_at: "2026-10-30T08:00:00+00:00" }),
  person({ email: "b@example.com", allowlist_status: "revoked", access: "revoked", signed_up: true }),
  person({ email: "c@example.com" }),
];
assert.deepEqual(filterPeople(people, "active", "").map((p) => p.email), ["owner@example.com", "a@example.com", "c@example.com"]);
assert.deepEqual(filterPeople(people, "revoked", "").map((p) => p.email), ["b@example.com"]);
assert.deepEqual(filterPeople(people, "signed_up", "").map((p) => p.email), ["owner@example.com", "a@example.com", "b@example.com"]);
assert.deepEqual(filterPeople(people, "never_signed_up", "").map((p) => p.email), ["c@example.com"]);
assert.deepEqual(filterPeople(people, null, " A@EXAMPLE").map((p) => p.email), ["a@example.com"]);
assert.deepEqual(counts(people), { active: 3, revoked: 1, no_access: 0, signed_up: 3, never_signed_up: 1 });
assert.equal(sortPeople(people)[0].owner, true, "owner row first");

// Remove needs the typed email; the owner has no actions.
assert.equal(emailMatches("A@Example.com ", "a@example.com"), true);
assert.equal(emailMatches("a@example.co", "a@example.com"), false);
assert.equal(emailMatches("", ""), false);
assert.match(page, /disabled=\{!ok \|\| busy\}/, "remove button stays off until the email matches");
assert.match(page, /emailMatches\(typed, person\.email\)/);
assert.match(page, /\{!person\.owner && \(/, "card actions are hidden for the owner");
assert.match(page, /\{!p\.owner && \(/, "table actions are hidden for the owner");

// Phone cards under 480px, table above.
assert.match(page, /min-\[480px\]:hidden/);
assert.match(page, /hidden min-\[480px\]:block/);

// Red only on the remove confirmation's destructive button.
assert.equal((page.match(/bg-red-500 text-sm/g) ?? []).length, 1, "one red button");
assert.ok(!/text-red|border-red|bg-red-(?!500 text-sm|600 disabled)/.test(page), "no other red in the page");
assert.ok(!/(text|bg|border)-red/.test(helpers), "no red in the helpers");

// Facts that are not stored say so.
assert.equal(WORDING.notRecorded, "Not recorded");
assert.match(page, /formatDate\(person\.signed_up_at\)/);

// Copy rules: no em dashes, no exclamation marks.
const copy = [page, helpers, ...Object.values(WORDING), ...Object.values(ACTION_LABELS), revokeMessage("x@y.z"), removeMessage("x@y.z")].join("\n");
assert.ok(!/—/.test(copy), "no em dashes");
assert.ok(!/!(?!=)/.test(Object.values(WORDING).join("")), "no exclamation marks in wording");
console.log("check:e12-people OK");

// The target of an action is an opaque id in the path, never an email, and the
// cursor is opaque too; the old allow-list calls are gone from api.ts.
assert.ok(!/listAllowlist|addAllowlist|revokeAllowlist/.test(apiSrc), "unused allow-list calls removed");
assert.ok(!/person\.key|p\.key/.test(page), "the page never addresses a person by key");
assert.match(page, /api\.revokeOpsPerson\(target\.id\)/);
console.log("check:e12-people ids OK");
