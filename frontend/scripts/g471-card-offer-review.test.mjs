import assert from "node:assert/strict";
import { makeOfferDrafts, validateCardOfferReview } from "../lib/cardOfferReview.ts";

const original = { offer_type: "balance_transfer", apr_pct: 0, balance: null, ends: "2027-08-01", revert_apr_pct: null, match: null };
const existing = [{ id: "p1", offer_type: "balance_transfer", kind: "balance_transfer", apr_pct: 0, balance: 10, ends: "2027-08-01" }];
const base = () => ({ drafts: makeOfferDrafts([original]), existing, removeIds: [], statementDate: "", purchaseApr: "", cashApr: "", cardId: "card-1", ackRequired: false, acknowledged: false, unknownAcknowledged: true, today: "2026-11-15" });

const draft = makeOfferDrafts([{ ...original, balance: 0, revert_apr_pct: 0 }])[0];
assert.equal(draft.rate, "0");
assert.equal(draft.balance, "0");
assert.equal(draft.revertRate, "0");

let result = validateCardOfferReview(base());
assert.equal(result.body?.offers?.[0].balance, null);
assert.equal(result.body?.offers?.[0].revert_apr_pct, null);
assert.equal("purchase_apr_pct" in (result.body ?? {}), false);
assert.equal("statement_date" in (result.body ?? {}), false);

result = validateCardOfferReview({ ...base(), unknownAcknowledged: false });
assert.equal(result.body, null);
assert.ok(result.errors.unknown);
result = validateCardOfferReview({ ...base(), drafts: [{ ...base().drafts[0], include: false }] });
assert.equal(result.body, null);
assert.ok(result.errors.offers, "an incomplete row excluded from saving does not create a payload");
result = validateCardOfferReview({ ...base(), drafts: [{ ...base().drafts[0], ends: "2026-11-14" }] });
assert.ok(result.errors["offer-0-ends"]);
result = validateCardOfferReview({ ...base(), drafts: [{ ...base().drafts[0], ends: "2026-11-15" }] });
assert.equal(result.body?.offers?.[0].ends, "2026-11-15");

const update = { ...base().drafts[0], updateId: "p1", balance: "1", revertRate: "23.9" };
result = validateCardOfferReview({ ...base(), drafts: [update, { ...update, key: "offer-1" }] });
assert.ok(result.errors["offer-0-updateId"] && result.errors["offer-1-updateId"]);
result = validateCardOfferReview({ ...base(), drafts: [{ ...update, updateId: "foreign" }] });
assert.ok(result.errors["offer-0-updateId"]);
result = validateCardOfferReview({ ...base(), drafts: [update], removeIds: ["p1"] });
assert.ok(result.errors["offer-0-updateId"]);
result = validateCardOfferReview({ ...base(), removeIds: ["foreign"] });
assert.ok(result.errors.offers);

const fourExisting = Array.from({ length: 4 }, (_, index) => ({ ...existing[0], id: `p${index}` }));
result = validateCardOfferReview({ ...base(), existing: fourExisting });
assert.ok(result.errors.offers, "an add over the four-offer cap is blocked");
result = validateCardOfferReview({ ...base(), existing: fourExisting, drafts: [{ ...update, updateId: "p0" }] });
assert.equal(result.errors.offers, undefined, "an update does not consume another offer slot");

result = validateCardOfferReview({ ...base(), cardId: "", ackRequired: true, acknowledged: false });
assert.ok(result.errors.card && result.errors.cardAck);
result = validateCardOfferReview({ ...base(), statementDate: "2026-11-16" });
assert.ok(result.errors.statementDate);

console.log("g471-card-offer-review: ok");
