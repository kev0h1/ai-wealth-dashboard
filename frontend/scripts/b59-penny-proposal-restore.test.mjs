// B59: a stored proposal turn restores as a card with its status, the card
// shows Before and After lines that mask under Hide balances, and a bare
// consequence sentence is never shown as a whole answer.
// Run: npm run -s check:b59-penny-proposal-restore
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";
import { ProposalConfirmCard } from "../components/PennyConversation.tsx";
import { answerText, isBareConsequence, proposalMsgFromTurn, LEGACY_PROPOSAL_NOTE } from "../lib/pennyProposalRestore.ts";

const noop = () => {};
const wrap = (hidden, el) => renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, el));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const turn = (status, extra = {}) => ({
  role: "assistant", text: "File the BRITISH GAS £159.70 on 1 Oct as Software instead of Bills. Changes only this transaction.",
  proposal_id: "p1",
  proposal: {
    proposal_id: "p1", kind: "recategorise_transaction", summary: "File the BRITISH GAS £159.70 on 1 Oct as Software instead of Bills.",
    consequence: "Changes only this transaction.", before: "Bills", after: "Software", entity: "BRITISH GAS", destructive: false, status, ...extra,
  },
});
const card = (hidden, t) => wrap(hidden, h(ProposalConfirmCard, { msg: proposalMsgFromTurn(t, 7), onConfirm: noop, onCancel: noop, onOpenDone: noop }));
let checks = 0;

// 1. Each stored status restores as the right message state.
{
  const m = (s) => proposalMsgFromTurn(turn(s), 1);
  assert.equal(m("pending").status, "pending");
  assert.equal(m("executed").status, "done");
  assert.equal(m("cancelled").status, "cancelled");
  assert.equal(m("expired").status, "error");
  assert.equal(m("expired").errorDetail, "Expired, ask again");
  assert.equal(m("pending").restored, true);
  assert.equal(proposalMsgFromTurn({ role: "assistant", text: "Plain answer." }, 1), null, "no block, no card");
  assert.equal(proposalMsgFromTurn({ role: "user", text: "hi" }, 1), null);
  checks += 7;
}

// 2. A pending card is live; resolved cards keep the summary and show a status line.
{
  const live = text(card(false, turn("pending")));
  assert.match(live, /Confirm/);
  assert.match(live, /Cancel/);
  assert.match(live, /Changes only this transaction\./);
  for (const [status, line] of [["executed", "Confirmed"], ["cancelled", "Cancelled"], ["expired", "Expired, ask again"]]) {
    const html = card(false, turn(status));
    const t = text(html);
    assert.match(t, new RegExp(line), `${status} shows its status line`);
    assert.match(t, /File the BRITISH GAS/, `${status} still says what the change was`);
    assert.doesNotMatch(html, /<button/, `${status} has no Confirm or Cancel buttons`);
  }
  checks += 11;
}

// 3. Before and After lines render and mask. Categories stay visible; money is masked.
{
  const shown = text(card(false, turn("pending")));
  assert.match(shown, /Before: Bills/);
  assert.match(shown, /After: Software/);
  const money = turn("pending", { before: "£120.00 per period", after: "£150.00 per period" });
  assert.match(text(card(false, money)), /Before: £120\.00 per period/);
  const hiddenHtml = card(true, money);
  assert.doesNotMatch(hiddenHtml, /£\d/, "no raw amount in the card when balances are hidden, summary included");
  assert.match(hiddenHtml, /Before/);
  assert.match(text(card(true, turn("pending"))), /Before: Bills/, "a category is not money, so it stays");
  const none = text(card(false, turn("pending", { before: null, after: null })));
  assert.doesNotMatch(none, /Before:|After:/, "no lines when a proposal has no single change");
  const resolved = card(true, turn("executed", { before: "£1.00", after: "£2.00" }));
  assert.doesNotMatch(resolved, /£\d/, "a resolved restored card masks too");
  checks += 7;
}

// 4. A bare consequence is never a whole answer.
{
  assert.equal(isBareConsequence("Changes only this transaction."), true);
  assert.equal(isBareConsequence("Sets a rule for this merchant and refiles 3 past transactions."), true);
  assert.equal(isBareConsequence("File it as Software. Changes only this transaction."), false);
  assert.equal(answerText("Changes only this transaction.", "File the BRITISH GAS as Software"), "File the BRITISH GAS as Software");
  assert.equal(answerText("Changes only this transaction."), LEGACY_PROPOSAL_NOTE);
  assert.equal(answerText("You spent £40 on food."), "You spent £40 on food.");
  assert.doesNotMatch(LEGACY_PROPOSAL_NOTE, /—|!/);
  checks += 7;
}

console.log(`b59-penny-proposal-restore: ${checks} checks passed`);
