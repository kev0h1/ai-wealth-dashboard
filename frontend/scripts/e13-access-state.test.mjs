// E13: pins the access-state chip and its single action on /ops/people, the
// typed Allow all confirmation, and the invite-only sign-in screen's
// request-access line. No em dashes, no exclamation marks.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  WORDING, ACTION_LABELS, accessLabel, accessAction, backfillBanner, backfillMessage, backfillConfirmed, isActive,
} from "../app/ops/people/people.ts";
import { SUPPORT_EMAIL } from "../lib/regulatoryCopy.ts";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const page = read("../app/ops/people/page.tsx");
const login = read("../components/LoginScreen.tsx");
const apiSrc = read("../lib/api.ts");
const terms = read("../content/terms.md");
const privacy = read("../content/privacy.md");

const p = (access) => ({ access, owner: access === "owner" });

// Chip text and the one matching action per state. Revoke is never offered
// to a row sign-in already refuses.
assert.deepEqual(["owner", "allowed", "no_access", "revoked"].map((a) => accessLabel(p(a))),
  ["Owner", "Allowed", "No access", "Revoked"]);
assert.deepEqual(["owner", "allowed", "no_access", "revoked"].map((a) => accessAction(p(a))),
  [null, "revoke", "allow", "restore"]);
assert.equal(WORDING.allowButton, "Allow");
assert.equal(WORDING.restoreButton, "Restore");
assert.equal(WORDING.revokeConfirm, "Revoke access");
assert.equal(isActive(p("no_access")), false, "a no-access row is not active");
assert.equal(isActive(p("allowed")), true);

// The page renders from accessAction, keeps Remove for non-owners, and wires the new calls.
assert.match(page, /accessAction\(person\)/);
assert.match(page, /action === "allow"/);
assert.match(page, /action === "revoke"/);
assert.match(page, /action === "restore"/);
assert.match(page, /\{!person\.owner && \(/, "actions hidden for the owner");
assert.ok(!/allowlist_status === "revoked"/.test(page), "the page no longer infers state from allowlist_status");
assert.match(page, /api\.allowOpsPerson\(p\.id\)/);
for (const route of ["/allow`", '"/ops/people/backfill"']) assert.ok(apiSrc.includes(route), `api.ts has ${route}`);

// Allow all: banner count, typed ALLOW, button disabled until it matches.
assert.equal(backfillBanner(3), "3 signed-up accounts have no access row. Sign-in refuses them until you allow them.");
assert.equal(backfillBanner(1), "1 signed-up account has no access row. Sign-in refuses it until you allow it.");
assert.equal(WORDING.backfillButton, "Allow all");
assert.equal(backfillConfirmed("ALLOW"), true);
assert.equal(backfillConfirmed(" ALLOW "), true);
assert.equal(backfillConfirmed("allow"), false);
assert.equal(backfillConfirmed(""), false);
assert.match(page, /backfillCount > 0/, "banner only when there is something to allow");
assert.match(page, /disabled=\{!ok \|\| busy\}/);
assert.match(page, /backfillConfirmed\(typed\)/);
assert.match(page, /api\.applyOpsBackfill\(typed\)/);

// Open sign-up hint, only when the server says so.
assert.equal(WORDING.openSignupHint, "Open sign-up is on, so people with no access can still sign in.");
assert.match(page, /openSignup && \(/);
assert.match(page, /res\.open_signup === true/);

// Sign-in screen: request-access line using the shared address, Try another account kept.
assert.match(login, /If you already use Sorted, or you were invited, email/);
assert.match(login, /and we can look into it\./);
assert.match(login, /mailto:\$\{SUPPORT_EMAIL\}/);
assert.match(login, /Try another account/);
assert.ok(!/@[a-z0-9-]+\.[a-z.]+/i.test(login.replace(/\{`mailto:/g, "")), "no address hard-coded in the sign-in screen");
// The shared constant is the address the legal pages publish.
assert.ok(terms.includes(SUPPORT_EMAIL) && privacy.includes(SUPPORT_EMAIL), "SUPPORT_EMAIL matches /terms and /privacy");

// Copy rules.
const inviteBlock = login.slice(login.indexOf("Sorted is invite-only right now"), login.indexOf("Try another account"));
const copy = [page, inviteBlock, ...Object.values(WORDING), ...Object.values(ACTION_LABELS), backfillBanner(2), backfillMessage(2)].join("\n");
assert.ok(!/—/.test(copy), "no em dashes");
assert.ok(!/!(?!=)/.test([...Object.values(WORDING), backfillBanner(2), backfillMessage(2)].join("")), "no exclamation marks");
console.log("check:e13-access-state OK");
