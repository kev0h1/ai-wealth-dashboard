// G334: Penny's move-plan card. Normaliser accept/reject, the shared move
// diagram now lives in components/MoveRoute.tsx (HomeBrief imports it), the
// card renders the legs, total and nothing-spare line with no control, copy has
// no em dash or exclamation, and Hide balances masks every figure.
// Run: npm run -s check:g334-penny-move-plan
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { default: PennyMovePlan } = await import("../components/PennyMovePlan.tsx");
const lib = await import("../lib/pennyMovePlan.ts");
const { BalancesHiddenContext } = await import("../lib/balancesHidden.tsx");
const h = React.createElement;
const html = (el, hidden = false) => renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, el));
const text = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const plan = {
  kind: "move_plan",
  target: { name: "Your Barclays account", bank: "Barclays", provider: "ob-barclays" },
  legs: [
    { name: "NatWest Select", bank: "NatWest", provider: "ob-natwest", amount: 146, keeps: 25 },
    { name: "Starling Personal", bank: "Starling", provider: "ob-starling", amount: 54, keeps: 0 },
  ],
  total: 200, pool: 236, requested: null, shortfall: 0,
  summary: "You could move up to £200.00 into your Barclays account: £146.00 from NatWest Select and £54.00 from Starling Personal.",
  skipped: [{ name: "Your HSBC account", reason: "nothing_spare" }, { name: "Saving Challenge", reason: "set_aside_pot" }],
};

// ---- 1. normaliser: accept and reject ---------------------------------------
{
  const ok = lib.normalisePennyMovePlan(plan);
  assert.ok(ok && ok.legs.length === 2 && ok.total === 200 && ok.target.name === "Your Barclays account");
  assert.deepEqual(lib.normalisePennyMovePlan(ok), ok, "normalising twice is harmless");
  const bad = (patch) => lib.normalisePennyMovePlan({ ...plan, ...patch });
  assert.equal(lib.normalisePennyMovePlan(null), null);
  assert.equal(lib.normalisePennyMovePlan("x"), null);
  assert.equal(bad({ kind: "chart" }), null);
  assert.equal(bad({ legs: [] }), null);
  assert.equal(bad({ legs: new Array(9).fill(plan.legs[0]) }), null);
  assert.ok(bad({ legs: new Array(8).fill(plan.legs[0]) }), "eight legs are drawn");
  assert.equal(bad({ legs: [{ ...plan.legs[0], amount: -1 }] }), null);
  assert.equal(bad({ legs: [{ ...plan.legs[0], amount: NaN }] }), null);
  assert.equal(bad({ legs: [{ ...plan.legs[0], amount: "146" }] }), null);
  assert.equal(bad({ total: Infinity }), null);
  assert.equal(bad({ summary: "" }), null);
  assert.equal(bad({ target: { name: "", bank: null, provider: "x" } }), null);
  assert.equal(bad({ skipped: [{ name: "x", reason: "because" }] }), null);
  assert.ok(bad({ skipped: undefined }) && bad({ pool: null }) && bad({ requested: null }));
}

// ---- 2. copy helpers ----------------------------------------------------------
{
  assert.equal(lib.formatMovePlanMoney(146), "£146.00");
  assert.equal(lib.formatMovePlanMoney(1234.5), "£1,234.50");
  assert.equal(lib.nothingSpareLine(plan.skipped), "Your HSBC account has nothing spare");
  const many = ["A", "B", "C", "D"].map((name) => ({ name, reason: "nothing_spare" }));
  assert.equal(lib.nothingSpareLine(many), "A, B and 2 more have nothing spare");
  assert.equal(lib.nothingSpareLine([{ name: "A", reason: "nothing_spare" }, { name: "B", reason: "nothing_spare" }]), "A and B have nothing spare");
  assert.equal(lib.nothingSpareLine([{ name: "Pot", reason: "set_aside_pot" }]), null);
}

// ---- 3. the card renders the route, rows, total, whisper; no control ----------
{
  const out = html(h(PennyMovePlan, { plan }));
  assert.ok(out.includes("data-penny-move-plan") && out.includes("data-move-route-summary"), "route diagram drawn");
  const t = text(out);
  assert.match(t, /£146\.00 from NatWest Select · keeps £25\.00/);
  assert.match(t, /£54\.00 from Starling Personal/);
  assert.doesNotMatch(t, /keeps £0\.00/, "no keeps figure when nothing is kept");
  assert.match(t, /Up to £200\.00 in total/);
  assert.match(t, /Your HSBC account has nothing spare/);
  assert.match(t, /2 accounts/, "From side says how many accounts");
  assert.match(t, /Your Barclays account/);
  assert.doesNotMatch(out, /<button|<a |role="button"|onClick/, "no button, no action");
  assert.doesNotMatch(text(out), /\bMove\b/, "no Move verb as a control");
  assert.doesNotMatch(out, /—|–/, "no dash glyphs in markup");
  assert.doesNotMatch(t, /!/, "no exclamation marks");
  assert.doesNotMatch(out, /bg-gradient|from-indigo|to-violet|(?:text|bg|border)-(?:red|rose)-/, "no gradient, no red");
  const asked = html(h(PennyMovePlan, { plan: { ...plan, requested: 300, shortfall: 100 } }));
  assert.match(text(asked), /You asked about £300\.00/);
  const exact = html(h(PennyMovePlan, { plan: { ...plan, requested: 200, shortfall: 0 } }));
  assert.match(text(exact), /£200\.00 in total/);
  assert.doesNotMatch(text(exact), /Up to/);
  assert.equal(html(h(PennyMovePlan, { plan: { ...plan, legs: [] } })), "", "malformed renders nothing");
  const evil = html(h(PennyMovePlan, { plan: { ...plan, target: { ...plan.target, name: "<img src=x onerror=1>" } } }));
  assert.ok(!evil.includes("<img"), "strings are drawn as text");
}

// ---- 4. masking ---------------------------------------------------------------
{
  const out = html(h(PennyMovePlan, { plan: { ...plan, requested: 300, shortfall: 100 } }), true);
  assert.doesNotMatch(out, /£\d/, "no raw amount when hidden");
  assert.match(out, /£••••/);
  assert.match(out, /Amount hidden/);
  assert.match(out, /NatWest Select/, "names stay");
  assert.match(html(h(PennyMovePlan, { plan })), /£146\.00/, "visible when not hidden");
}

// ---- 5. wiring ----------------------------------------------------------------
{
  const route = readFileSync(new URL("../components/MoveRoute.tsx", import.meta.url), "utf8");
  for (const n of ["MoveRouteSummary", "MoveAccountStack", "MoveSourcesDisclosure", "MoveAccountIcon", "resolveBankChip", "moveMoney"]) {
    assert.match(route, new RegExp(`export function ${n}\\b`), `${n} exported from MoveRoute`);
  }
  assert.match(route, /export type MoveLedgerLeg\b/);
  const brief = readFileSync(new URL("../components/HomeBrief.tsx", import.meta.url), "utf8");
  assert.match(brief, /import \{[^}]*MoveRouteSummary[^}]*\} from "@\/components\/MoveRoute"/, "HomeBrief imports the shared diagram");
  assert.doesNotMatch(brief, /function MoveRouteSummary|function MoveAccountStack|function resolveBankChip/, "no second copy in HomeBrief");
  const conv = readFileSync(new URL("../components/PennyConversation.tsx", import.meta.url), "utf8");
  assert.ok(conv.includes("normalisePennyMovePlan(res.move_plan)") && conv.includes("normalisePennyMovePlan(t.move_plan)"), "live and stored replies normalise the card");
  assert.ok(conv.includes("{msg.move_plan && <PennyMovePlan plan={msg.move_plan} />}"), "VerdictBubble renders the card");
  assert.ok(/msg\.table \|\| msg\.chart \|\| msg\.move_plan \? PENNY_BUBBLE_TABLE/.test(conv), "wide bubble for a move plan");
  const card = readFileSync(new URL("../components/PennyMovePlan.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(card, /—/, "no em dash in the card source");
  assert.ok(card.includes("useBalancesHidden"));
}

console.log("g334-penny-move-plan: all checks passed");
