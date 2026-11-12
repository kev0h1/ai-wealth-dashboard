import assert from "node:assert/strict";
import { prioritisePlanFillCandidates } from "../lib/planPaymentCandidates.ts";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountRadioPicker } from "../components/AccountRadioPicker.tsx";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";

const candidate = (series_key, display_name, extra = {}) => ({ series_key, display_name, last_amount: 12.04, last_date: "2026-11-12", occurrences_90d: 3, ...extra });
const other = candidate("other", "Another payment");
const destination = candidate("destination", "Saving Challenge", { match_value: "RAW CHALLENGE REFERENCE" });
const suggestion = { match_type: "description_contains", match_value: "RAW CHALLENGE REFERENCE", fill_display_name: "Saving Challenge", last_amount: 12.04, last_date: "2026-11-12", occurrences_90d: 3 };

const response = { items: [other, destination], suggestion };
const before = structuredClone(response);
assert.deepEqual(prioritisePlanFillCandidates(response), [destination, other], "the selected receiving account's payment leads even when an unrelated payment was newer");
assert.deepEqual(response, before, "ordering must not mutate cached server data");
assert.equal(prioritisePlanFillCandidates(response).filter(item => item.series_key === "destination").length, 1, "a suggestion already in the list appears once");
const missing = prioritisePlanFillCandidates({ items: [other], suggestion });
assert.equal(missing[0].display_name, suggestion.match_value, "an absent suggested rule preserves its actual matching text");
assert.equal(missing[1], other, "other payments remain selectable");
assert.deepEqual(prioritisePlanFillCandidates({ items: [other, destination], suggestion: null }), [other, destination], "no suggestion preserves the server ordering");
assert.deepEqual(prioritisePlanFillCandidates({ items: [], suggestion: null }), [], "no payment evidence remains an empty list");
const account = { id: "source", name: "Paying account", provider: "Monzo", balance: -125, type: "bank", subtype: "CURRENT_ACCOUNT", currency: "GBP", status: "active", manual: false };
const render = hidden => renderToStaticMarkup(React.createElement(BalancesHiddenContext.Provider, { value: hidden }, React.createElement(AccountRadioPicker, { accounts: [account], value: "source", onChange() {} })));
assert.match(render(false), /−£125/, "a paying account's negative balance retains its sign");
assert.doesNotMatch(render(true), /£125/, "opening an account picker must honour Hide balances");
assert.match(render(true), /−£••••/, "the privacy mask retains a negative sign");
console.log("G461: payment priority, rule identity, cache immutability, empty evidence and account privacy passed");
