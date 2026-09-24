// Renders every spend-from treatment through react-dom/server (G148
// re-review, 2026-09-23) and asserts each one produces real markup.
//
// Run with:
//   node --no-warnings --experimental-loader ./scripts/_tsx-loader.mjs scripts/spend-from-render.test.mjs
// or:
//   npm run -s check:spend-from-render
//
// Why this exists ON TOP of scripts/spend-from-account.test.mjs.
//
// The first G148 guard asserted over the pure plan (every non-pending kind
// carries a message or entries) and then read components/SafeToSpendCard.tsx
// as TEXT: an explicit `case` per kind, exactly one `return null;`, and a
// `<SpendFromUnavailableNote` substring. Re-review broke it in one character:
//
//     case "not-available":
//       return { body: null };          // was: return null;
//
// The rail is invisible again, and every check, tsc and the production build
// still pass. A source-text guard cannot tell "returns nothing" from "returns
// a shape containing nothing", and both are the bug.
//
// The only assertion that cannot be fooled is the rendered output, so this
// file renders it. `approvedSpendFromTreatment` is exported from the card and
// called here with each plan kind; `renderToStaticMarkup` runs it the way a
// Next server pass would. scripts/_tsx-loader.mjs is what makes a .tsx
// component importable at all from this runner (Node's
// --experimental-strip-types cannot handle JSX, which is a large part of why
// this branch went untested for so long).
//
// Note this renders the treatment, not the whole card: SafeToSpendCard calls
// useRouter() in its body, which throws outside a mounted app router. The
// treatment function is the unit that decides whether anything reaches the
// screen, which is the thing that was wrong.
//
// ── The ceiling on this technique, for whoever extends it ─────────────────
//
// Server-rendered markup cannot see VISIBILITY. Every assertion below is
// satisfied by output that no sighted user will ever read:
//
//     return { body: <div hidden className="sr-only">Spend from: not
//              available right now.</div> };
//
// passes this file, passes the plan assertions, passes tsc and passes the
// production build. The realistic form is worse because it looks innocent: a
// responsive utility like `hidden sm:block` would blank the rail on exactly
// the phone width Kevin reviews on while every gate stays green.
//
// Deliberately not "fixed" with a class blocklist, because the treatments
// legitimately use `sr-only` for their screen-reader labels, so a blanket
// rule would be wrong as often as it was right. Closing it properly means
// measuring computed styles at a real viewport, which is what the /design
// preview and its screenshots are for. Treat this file as proof that
// something is EMITTED, not proof that it is SEEN.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { bestSpendAccount, spendFromTreatmentPlan } from "../lib/spendFromAccount.ts";
import { approvedSpendFromTreatment } from "../components/SafeToSpendCard.tsx";

let failures = 0;

function check(label, cond) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

const amount = (v) => `£${Math.abs(v).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
const noop = () => {};

function account(overrides) {
  return {
    id: "acc", name: "Account", type: "TRANSACTION", subtype: "CURRENT", balance: 100,
    currency: "GBP", provider: "Monzo", provider_id: "monzo", status: "AUTHORIZED",
    cover_source_eligible: true, ...overrides,
  };
}
const ACCOUNTS = [
  account({ id: "monzo", name: "Everyday", provider: "Monzo", provider_id: "monzo" }),
  account({ id: "chase", name: "Flex current", provider: "Chase", provider_id: "chase_uk" }),
];

// Bank-mark availability is injected into the plan, so both the branded
// (bank rail) and unbranded (named rows) treatments are reachable here
// without depending on which logos happen to be bundled.
const PLANS = {
  "bank-rail": spendFromTreatmentPlan(
    bestSpendAccount({ monzo: { short: false, headroom: 74.85 }, chase: { short: false, headroom: 69.74 } }, ACCOUNTS),
    () => true,
  ),
  "name-fallback": spendFromTreatmentPlan(
    bestSpendAccount({ monzo: { short: false, headroom: 74.85 }, chase: { short: false, headroom: 69.74 } }, ACCOUNTS),
    () => false,
  ),
  "no-current": spendFromTreatmentPlan(
    bestSpendAccount({ monzo: { short: true, headroom: 0 }, chase: { short: true, headroom: 1 } }, ACCOUNTS),
    () => true,
  ),
  "not-available": spendFromTreatmentPlan(bestSpendAccount(undefined, ACCOUNTS, "ready"), () => true),
  "check-failed": spendFromTreatmentPlan(bestSpendAccount(undefined, ACCOUNTS, "failed"), () => true),
  pending: spendFromTreatmentPlan(bestSpendAccount(undefined, ACCOUNTS, "loading"), () => true),
};

function renderTreatment(plan) {
  const treatment = approvedSpendFromTreatment(plan, amount, false, noop, noop);
  if (treatment == null) return { treatment: null, markup: "" };
  const markup =
    (treatment.heroAside ? renderToStaticMarkup(React.createElement(React.Fragment, null, treatment.heroAside)) : "")
    + (treatment.body ? renderToStaticMarkup(React.createElement(React.Fragment, null, treatment.body)) : "");
  return { treatment, markup };
}

// ── Every kind except the in-flight one must put pixels on the screen ──────
for (const [kind, plan] of Object.entries(PLANS)) {
  check(`plan for '${kind}' is the kind it claims`, plan.kind === kind);
  const { treatment, markup } = renderTreatment(plan);

  if (kind === "pending") {
    check("'pending' renders nothing at all (the one state allowed to)", treatment === null);
    continue;
  }

  // The assertion re-review's `return { body: null }` had to survive, and
  // does not: a treatment object whose rendered output is empty fails here
  // exactly as a bare `return null` does.
  check(`'${kind}' returns a treatment, not null`, treatment !== null);
  check(`'${kind}' renders non-empty markup`, markup.trim().length > 0);
  // Not just an empty wrapper div: something a human can actually read.
  const text = markup.replace(/<[^>]*>/g, "").replace(/&[a-z]+;/g, " ").trim();
  check(`'${kind}' renders visible text, not an empty shell`, text.length > 0);
}

// ── The two absent states say their own different thing, on screen ─────────
{
  const missing = renderTreatment(PLANS["not-available"]).markup;
  const failed = renderTreatment(PLANS["check-failed"]).markup;
  check("the absent-field state renders its sentence", missing.includes("not available right now"));
  check("the failed-request state renders its own, different sentence", failed.includes("could not check your accounts"));
  check("the two absent states do not render identical markup", missing !== failed);
  check("only the failed state offers a retry control", failed.includes("Try again") && !missing.includes("Try again"));
  check("neither absent state uses an em dash (DESIGN.md)", !missing.includes("—") && !failed.includes("—"));
  // DESIGN.md: error/unsupported states on this card stay neutral ink "with
  // no colour signal at all". The no-room line is the one that earns amber.
  check("neither absent state carries a colour signal", !/amber|rose|red-/.test(missing + failed));
  check("the no-room line does carry its amber dot", renderTreatment(PLANS["no-current"]).markup.includes("amber"));
}

// ── The healthy states still render their real content ─────────────────────
{
  const rail = renderTreatment(PLANS["bank-rail"]).markup;
  check("the bank rail renders its 'Spend from' label", rail.includes("Spend from"));
  check("the bank rail renders both account amounts", rail.includes("£75") && rail.includes("£70"));
  const rows = renderTreatment(PLANS["name-fallback"]).markup;
  check("the named-rows fallback renders both account names", rows.includes("Everyday") && rows.includes("Flex current"));
}

// ── The retry is a real 44px target (re-review finding 5) ──────────────────
{
  const failed = renderTreatment(PLANS["check-failed"]).markup;
  check("the retry control is min-h-11, the project's stated target size", failed.includes("min-h-11"));
  check("the retry control has horizontal padding, so the hit area is not just the word", /class="[^"]*\bpx-2\b/.test(failed));
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll spend-from render (G148) checks passed.");
