import assert from "node:assert/strict";
import {
  listCardOffers,
  monthlyClearingIllustration,
  offerLabel,
  offerTimeLeft,
} from "../lib/cardOffers.ts";

const zero = (until, balance = 100, extras = {}) => ({ kind: "purchases", apr_pct: 0, until, balance, ...extras });

// A 31st date clamps independently: March returns to the 31st after February.
assert.deepEqual(
  monthlyClearingIllustration(zero("2024-04-01", 300), "2024-01-31"),
  { monthlyAmount: 150, paymentCount: 2, firstPaymentDate: "2024-02-29", lastPaymentDate: "2024-03-31" },
);
assert.deepEqual(
  monthlyClearingIllustration(zero("2025-04-01", 200), "2025-01-31"),
  { monthlyAmount: 100, paymentCount: 2, firstPaymentDate: "2025-02-28", lastPaymentDate: "2025-03-31" },
);

// A payment on the expiry day is not counted.
assert.equal(monthlyClearingIllustration(zero("2026-12-15", 312), "2026-11-15"), null);
assert.equal(monthlyClearingIllustration(zero("2026-11-15"), "2026-11-15"), null);
assert.equal(monthlyClearingIllustration({ ...zero("2027-02-01"), apr_pct: 3.9 }, "2026-11-15"), null);
assert.equal(monthlyClearingIllustration(zero("2027-02-01", null), "2026-11-15"), null);
assert.equal(monthlyClearingIllustration(zero("2027-02-01", 0), "2026-11-15"), null);
assert.equal(monthlyClearingIllustration(zero("not-a-date"), "2026-11-15"), null);
assert.deepEqual(
  monthlyClearingIllustration(zero("9999-12-31", 95686), "2026-01-31"),
  { monthlyAmount: 1, paymentCount: 95686, firstPaymentDate: "2026-02-28", lastPaymentDate: "9999-11-30" },
  "far-future offers use calendar arithmetic without walking every month",
);

assert.equal(offerTimeLeft("2026-11-16", "2026-11-15"), "1 day left");
assert.equal(offerTimeLeft(null, "2026-11-15"), null);
assert.equal(offerTimeLeft("not-a-date", "2026-11-15"), null);
assert.equal(offerLabel({ kind: "balance_transfer", offer_type: "money_transfer" }), "Money transfer");
assert.equal(offerLabel({ kind: "both" }), "Purchases and balance transfers");

const cards = [
  { account_id: "late", name: "Late", provider: "Test", balance: -1, currency: "GBP", source: "fixture", ask_eligible: false, terms: { promos: [zero("2027-08-01"), zero("bad-date")] } },
  { account_id: "early", name: "Early", provider: "Test", balance: -1, currency: "GBP", source: "fixture", ask_eligible: false, terms: { promos: [{ ...zero("2026-12-15"), id: "known" }] } },
  { account_id: "legacy", name: "Legacy", provider: "Test", balance: -5000, currency: "GBP", source: "fixture", ask_eligible: false, terms: { promos: [{ kind: "purchases", apr_pct: 0, until: "2028-01-01" }] } },
];
const flattened = listCardOffers(cards);
assert.deepEqual(flattened.map((row) => row.id), ["early:known", "late:0", "legacy:0", "late:1"]);
assert.equal(flattened[2].promo.balance, undefined, "a card's balance never becomes a promo balance");
assert.deepEqual(cards[0].terms.promos.map((promo) => promo.until), ["2027-08-01", "bad-date"], "input arrays are not mutated");

const duplicateIds = listCardOffers([
  { ...cards[0], account_id: "one", terms: { promos: [{ ...zero("2027-01-01"), id: "same" }] } },
  { ...cards[0], account_id: "two", terms: { promos: [{ ...zero("2027-02-01"), id: "same" }] } },
]);
assert.deepEqual(duplicateIds.map((row) => row.id), ["one:same", "two:same"], "promo ids are scoped to their card");

console.log("g471-card-offers-helpers: ok");
