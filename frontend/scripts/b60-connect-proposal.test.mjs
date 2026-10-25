// B60: Penny never connects a bank. The connect_bank proposal card shows the
// Finexer disclosure, its button reads Continue to Finexer, the bank picker
// opens only after that tap, and every other proposal kind is unchanged.
// Run: npm run -s check:b60-connect-proposal
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";
import {
  ProposalConfirmCard, CONNECT_BANK_CLOSING, CONNECT_BANK_DONE, connectBankName,
} from "../components/PennyConversation.tsx";
import { matchBank } from "../components/bank-connect/BankConnectionFlow.tsx";
import { AGENT_DISCLOSURE, TRADING_NAME_DISCLOSURE } from "../lib/regulatoryCopy.ts";

const noop = () => {};
const html = (msg) => renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: false },
  h(ProposalConfirmCard, { msg, onConfirm: noop, onCancel: noop, onOpenDone: noop })));
const text = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/ ([.,])/g, "$1");
const connect = (status, extra = {}) => ({
  id: 1, role: "assistant", kind: "proposal", status,
  proposal: { proposal_id: "p1", kind: "connect_bank", summary: "Connect Monzo through Finexer", consequence: "server text", params: { bank: "Monzo" }, entity: "Monzo", ...extra },
});
const generic = (status) => ({
  id: 2, role: "assistant", kind: "proposal", status,
  proposal: { proposal_id: "p2", kind: "set_savings_goal", summary: "Set your safety buffer to £2,000", consequence: "Changes the target only.", params: {}, before: "Not set", after: "£2,000" },
});
let checks = 0;

// 1. The connect card: disclosure (trading name first), closing line, the button label.
{
  const t = text(html(connect("pending")));
  assert.ok(t.includes(`${TRADING_NAME_DISCLOSURE} ${AGENT_DISCLOSURE}`), "disclosure, trading name directly before the agent sentence");
  assert.ok(t.includes(CONNECT_BANK_CLOSING));
  assert.ok(t.includes("Connect Monzo through Finexer"));
  assert.ok(t.includes("Continue to Finexer") && t.includes("Cancel"));
  assert.ok(!t.includes("Confirm"), "no generic Confirm label on the connect card");
  assert.ok(!t.includes("server text"), "the disclosure comes from the shared constants, not the server string");
  assert.ok(text(html(connect("executing"))).includes("Continuing"));
  checks += 7;
}

// 2. No auto-open: the card renders no sheet, and the host opens the picker only from a tap.
{
  const markup = html(connect("pending"));
  assert.ok(!/role="dialog"|Choose your bank|data-sheet-overlay/.test(markup), "the card itself opens nothing");
  const src = readFileSync(new URL("../components/PennyConversation.tsx", import.meta.url), "utf8");
  const opens = [...src.matchAll(/setConnectBank\(\{/g)];
  assert.equal(opens.length, 2, "exactly two places open the picker: the confirm result and the done-row tap");
  const first = src.slice(0, opens[0].index);
  assert.ok(/executePennyProposal\(proposalId\)[\s\S]{0,900}$/.test(first), "the first is inside the confirm handler, after the execute call");
  assert.ok(/onOpenDone=\{\(\) => m\.proposal\.kind === CONNECT_BANK_KIND\s*\?\s*setConnectBank/.test(src), "the second is the done-row tap");
  assert.ok(!/useEffect\([^)]*setConnectBank/.test(src), "no effect opens the picker");
  assert.ok(/\{connectBank && \(\s*<Suspense/.test(src), "the picker renders only while connectBank is set");
  checks += 6;
}

// 3. The done state for connect, and the generic kinds unchanged.
{
  const done = text(html(connect("done")));
  assert.ok(done.includes(CONNECT_BANK_DONE) && !done.includes("is set up"));
  const g = text(html(generic("pending")));
  assert.ok(g.includes("Confirm") && !g.includes("Continue to Finexer") && !g.includes("trading name"));
  assert.ok(g.includes("Changes the target only.") && g.includes("Before: Not set") && g.includes("After: £2,000"));
  const gd = text(html(generic("done")));
  assert.ok(gd.includes("Done. Set your safety buffer to £2,000 is set up"));
  checks += 5;
}

// 4. A restored chat has no params: the entity carries the bank. Picker matching.
{
  assert.equal(connectBankName(connect("pending").proposal), "Monzo");
  assert.equal(connectBankName(connect("pending", { params: {}, entity: "Starling" }).proposal), "Starling");
  assert.equal(connectBankName(connect("pending", { params: { bank: null }, entity: null }).proposal), null);
  const banks = [{ id: "1", name: "Monzo", logo: "" }, { id: "2", name: "Barclays", logo: "" }, { id: "3", name: "Barclays Business", logo: "" }];
  assert.equal(matchBank(banks, "monzo")?.id, "1");
  assert.equal(matchBank(banks, "Barclays")?.id, "2", "an exact name wins over a longer one");
  assert.equal(matchBank(banks, "Barc"), null, "an ambiguous partial opens the list");
  assert.equal(matchBank(banks, "Nationwide"), null);
  assert.equal(matchBank(banks, undefined), null);
  checks += 8;
}

console.log(`b60 connect proposal: ${checks} checks passed`);
