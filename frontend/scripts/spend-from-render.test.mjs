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
import SpendFromAccountList from "../components/SpendFromAccountList.tsx";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";

let failures = 0;

function check(label, cond, detail) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}${detail ? ` (${detail})` : ""}`);
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
  // G234: the backend has already capped the figure at the pooled Safe to
  // Spend (110.36 here, Barclays-style raw 127), so the rail renders £110.
  capped: spendFromTreatmentPlan(
    bestSpendAccount({ monzo: { short: false, headroom: 127, spend_from_headroom: 110.36, account_headroom_raw: 127, spend_from_capped: true } }, ACCOUNTS),
    () => true,
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
  check(`plan for '${kind}' is the kind it claims`, plan.kind === (kind === "capped" ? "bank-rail" : kind));
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

// ── The healthy states use the approved B account list ─────────────────────
{
  const rail = renderTreatment(PLANS["bank-rail"]).markup;
  check("the account list renders its 'Held in' label", rail.includes("Held in"));
  check("the account list replaces the obsolete footnote with its approved scope caption", rail.includes("One estimate across these accounts.") && !rail.includes("Each figure is how much of your estimate"));
  check("the account list identifies its approved layout", rail.includes('data-spend-from-layout="account-list"'));
  check("the account list has a semantic list", /<ul[^>]*\baria-label="Accounts holding part of this estimate"/.test(rail));
  const railLiTags = rail.match(/<li\b[^>]*>/g) ?? [];
  check("the account list renders real list rows, never display:contents", railLiTags.length === 2 && railLiTags.every((tag) => !/\bclass="[^"]*\bcontents\b[^"]*"/.test(tag)));
  const rows = renderTreatment(PLANS["name-fallback"]).markup;
  check("the no-logo treatment uses the same account-list layout", rows.includes('data-g115-treatment="name-fallback"') && rows.includes('data-spend-from-layout="account-list"'));
}

// ── G234: a capped figure renders, and the rail never exceeds the hero ────
{
  const HERO = 110.36;
  const capped = renderTreatment(PLANS.capped).markup;
  check("G234: the capped rail renders the capped £110, not the raw £127", capped.includes("£110") && !capped.includes("£127"));
  for (const [kind, plan] of Object.entries(PLANS)) {
    for (const entry of plan.entries) {
      check(`G234: '${kind}' rail entry ${entry.name} does not exceed the hero figure`, kind === "capped" ? entry.headroom <= HERO : true);
    }
  }
  check("G234: a lower account amount is marked as a limit", capped.includes('data-spend-from-limit'));
}

// ── G320 B: account limits share one total, with named account identity ───
{
  const entries = [
    { accountId: "b1", name: "PREMIER CURRENT ACCOUNT", headroom: 120, capped: true, provider: "Barclays", account: account({ id: "b1", name: "PREMIER CURRENT ACCOUNT", provider: "Barclays", provider_id: "barclays_personal" }) },
    { accountId: "b2", name: "MAINGI K M", headroom: 30, capped: false, provider: "Barclays", account: account({ id: "b2", name: "MAINGI K M", provider: "Barclays", provider_id: "barclays_personal" }) },
  ];
  const renderList = (props = {}) => renderToStaticMarkup(React.createElement(SpendFromAccountList, {
    entries, pool: 120, amount, coverMoveVisible: false, onLogoError: noop, kind: "bank-rail", ...props,
  }));
  const textOf = (html) => html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const markup = renderList();
  check("G320: pool-sized account figure is not repeated", !markup.includes("£120 held"));
  check("G320: lower account limit remains visible", markup.includes("£30") && markup.includes('data-spend-from-limit'));
  check("G320: lower limits explicitly share the one total", markup.includes("Account limits share the total above."));
  check("G320: duplicate bank accounts show their display names", markup.includes("Premier Current Account") && markup.includes("Maingi K M"));
  check("G320: rows are semantic list items with account markers", (markup.match(/data-spend-from-account=/g) ?? []).length === 2 && (markup.match(/<li /g) ?? []).length === 2);

  const unknownPool = renderList({ pool: null });
  check("G320: an unknown pool keeps an account figure", unknownPool.includes("£120") && unknownPool.includes("£30"));

  const noLogo = renderToStaticMarkup(React.createElement(SpendFromAccountList, {
    entries: [{ accountId: "unknown", name: "Everyday", headroom: 15, capped: false, provider: "Zzyzx Bank", account: account({ id: "unknown", provider: "Zzyzx Bank", provider_id: "zzyzx" }) }],
    pool: 20, amount, coverMoveVisible: false, onLogoError: noop, kind: "name-fallback",
  }));
  check("G320: unknown banks use the existing badge fallback", noLogo.includes("Zzyzx Bank") && !noLogo.includes("/banks/zzyzx"));

  const withReserve = renderList({ coverMoveVisible: true, reserveByAccount: { b2: 12 } });
  check("G320: a visible move names its source reserve", textOf(withReserve).includes("£12 held back for the move") && !withReserve.includes("The move above is already held back."));
  check("G320: reserve metadata does not deduct from the account limit", textOf(withReserve).includes("£30 held") && (withReserve.match(/held back for the move/g) ?? []).length === 1);
  const withoutReserve = renderList({ coverMoveVisible: true });
  check("G320: a visible move without source metadata keeps the neutral reconciliation", withoutReserve.includes("The move above is already held back."));
  check("G320: no move renders neither reserve note", !markup.includes("held back for the move") && !markup.includes("The move above is already held back."));
  check("G320: hiding a move suppresses stale reserve metadata", !renderList({ coverMoveVisible: false, reserveByAccount: { b2: 12 } }).includes("held back for the move"));

  const masked = renderToStaticMarkup(React.createElement(BalancesHiddenContext.Provider, { value: true }, React.createElement(SpendFromAccountList, {
    entries, pool: 120, amount, coverMoveVisible: true, reserveByAccount: { b2: 12 }, onLogoError: noop, kind: "bank-rail",
  })));
  check("G320: hidden amounts are masked in the DOM", !masked.includes("£30") && !masked.includes("£12") && masked.includes("£••••"));
  check("G320: hidden amounts are not exposed through ARIA", !masked.includes("aria-label=\"£") && masked.includes('aria-label="Amount hidden"'));

  const treatment = approvedSpendFromTreatment(
    spendFromTreatmentPlan(bestSpendAccount({ monzo: { short: false, headroom: 40 }, chase: { short: false, headroom: 30 } }, ACCOUNTS), () => true, 120),
    amount, true, noop, noop, { chase: 12 },
  );
  const treatmentMarkup = renderToStaticMarkup(React.createElement(React.Fragment, null, treatment?.heroAside ?? null, treatment?.body ?? null));
  check("G320: healthy treatment returns the list as its body, not a hero aside", treatment?.heroAside == null && treatmentMarkup.includes('data-spend-from-layout="account-list"'));
  check("G320: the renderer forwards reserve metadata after onRetry", textOf(treatmentMarkup).includes("£12 held back for the move"));
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
