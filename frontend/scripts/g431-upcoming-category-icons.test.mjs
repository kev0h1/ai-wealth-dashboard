import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ICON_LIBRARY } from "../lib/categoryIcons.ts";
import UpcomingAccountDetails from "../components/upcoming/UpcomingAccountDetails.tsx";
import UpcomingRow from "../components/upcoming/UpcomingRow.tsx";
import { upcomingCategoryAppearance } from "../components/upcoming/UpcomingCategoryIcon.tsx";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";
import { walkUpcomingAccounts } from "../lib/upcomingAccountWalk.ts";

// Follow real cashflow occurrences into account activity. A category must not
// disappear in that adapter, even for savings movements or uncredited income.
const cases = [
  ["Card repayment", "Debt", "credit-card", "movement", true],
  ["Savings order", "Savings", "piggy-bank", "movement"],
  ["Uncategorised payment", null, "tag"],
  ["Streaming", "Subscriptions", "repeat"],
  ["Shopping", "Shopping", "shopping-bag"],
  ["Energy", "Bills", "receipt"],
  ["Software", "Software", "laptop"],
  ["Eating out", "Eating Out", "fork-knife"],
  ["Own account transfer", "Transfer", "arrows-left-right", "movement"],
  ["Custom pet category", "Pets", "paw-print"],
  ["Unknown category", "Unrecognised", "tag"],
];
const bill = ([name, category, , kind = "commitment", is_card_repayment]) => ({
  name, category, kind, is_card_repayment, amount: 12.34, expected_date: "2026-11-09", days_away: 2,
  account_id: "current", account_bank: "BARCLAYS", account_name: "Premier Current Account", account_balance: 2000,
});
const bills = cases.map(bill);
const income = [
  { ...bill(["Salary", null]), credit_basis: "confirmed" },
  { ...bill(["Possible freelance income", "Software"]), credit_basis: null },
];
const inflow = { account_id: "current", source_account_id: "source", source_account_name: "Other account", amount: 5, expected_date: "2026-11-09" };
const walk = walkUpcomingAccounts({ upcoming_bills: bills, upcoming_income: income, internal_inflows: [inflow] }, Date.parse("2026-11-30T23:59:59Z"), [{ id: "source", name: "Other account", bank: "HSBC", balance: 100 }]);
const account = walk.accounts.find(item => item.id === "current");
assert.ok(account);
assert.equal(account.events.find(event => event.name === "Possible freelance income").credited, false);
assert.equal(account.events.find(event => event.kind === "inflow").category, "Transfer");

const renderSheet = (value = account, hidden = false) => renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, h(UpcomingAccountDetails, {
  account: value, periodLabel: "This pay period", onEvent() {},
})));
const sheet = renderSheet();
const activityRow = (markup, id) => markup.match(new RegExp(`<button[^>]*data-flow-focus="event-${id}"[^>]*>([\\s\\S]*?)</button>`))?.[1] ?? "";
const tile = markup => markup.match(/<span class="flex h-8 w-8[^>]*>[\s\S]*?<\/svg><\/span>/)?.[0];

for (const [name, category, glyph] of cases) {
  const event = account.events.find(item => item.name === name);
  assert.equal(event.source, bills.find(item => item.name === name), `${name}: source identity survives`);
  assert.equal(event.category ?? null, category, `${name}: category survives`);
  const row = activityRow(sheet, event.id);
  assert.match(row, new RegExp(`data-phosphor-icon="${glyph}"`), `${name}: category glyph replaces the generic receipt`);
  assert.match(row, /−£12\.34/, `${name}: signed exact payment survives`);
  const appearance = upcomingCategoryAppearance(category, "bill", {}, {});
  const main = renderToStaticMarkup(h(UpcomingRow, {
    model: { rowKey: name, type: "bill", name, amount: 12.34, expectedDate: event.date, category, categoryColour: appearance.colour, CategoryIcon: appearance.Icon, after: { kind: "balance", value: 100 } },
    treatment: "needs-attention", onOpen() {}, onDismiss() {},
  }));
  assert.ok(tile(row), `${name}: sheet has a category tile`);
  assert.equal(tile(row), tile(main), `${name}: sheet and dated list have identical tiles`);
}
assert.match(activityRow(sheet, account.events.find(event => event.name === "Salary").id), /data-phosphor-icon="money"[\s\S]*?\+£12\.34/, "uncategorised income uses Income identity and its positive sign");
assert.match(activityRow(sheet, account.events.find(event => event.name === "Possible freelance income").id), /data-phosphor-icon="laptop"[\s\S]*?Not counted until it is confirmed/, "uncredited income keeps its category and caveat");
assert.match(activityRow(sheet, account.events.find(event => event.kind === "inflow").id), /data-phosphor-icon="arrows-left-right"[\s\S]*?\+£5\.00/, "own-account inflow stays a transfer");
const uncategorisedMove = { ...account.events[0], id: "legacy-move", kind: "movement", category: undefined };
assert.match(activityRow(renderSheet({ ...account, events: [uncategorisedMove] }), uncategorisedMove.id), /data-phosphor-icon="arrows-left-right"/, "an older movement without category keeps its transfer identity");

const customised = upcomingCategoryAppearance("Subscriptions", "bill", { Subscriptions: "#336699" }, { Subscriptions: "Coffee" });
assert.equal(customised.Icon, ICON_LIBRARY.coffee, "saved icon override wins");
assert.equal(customised.colour, "#336699", "saved colour override wins");

const suggested = renderSheet({ ...account, position: {
  afterPayments: -20, lowPoint: -20, plansReserved: 0, afterPaymentsAndPlans: -20, lowPointAndPlans: -20, spendFrom: 0, uncertain: false,
  earmarksOut: [{ toAccountId: "destination", toName: "Other account", amount: 20 }],
  coveredByMove: { amount: 20, shortfall: 20, from: [{ accountId: "source", name: "Other account", amount: 20 }] }, shortAfterCover: 0,
} });
for (const [id, glyph] of [["suggested:current:destination", "arrow-up-right"], ["suggested:source:current", "arrow-down-left"]]) {
  const row = suggested.match(new RegExp(`<li data-suggested-move="${id}"[\\s\\S]*?</li>`))?.[0] ?? "";
  assert.match(row, new RegExp(`lucide-${glyph}`), "suggested moves keep their directional arrows");
  assert.equal(tile(row), undefined, "suggested moves do not become payment category tiles");
}
const hidden = renderSheet(account, true);
assert.doesNotMatch(hidden, /£\d/, "all account-sheet money, including accessible labels, remains masked");
assert.match(hidden, /−£••••/, "masked outgoings keep their sign");
assert.equal((hidden.match(/class="flex h-8 w-8/g) ?? []).length, account.events.length, "privacy does not hide category identity");
console.log("g431 upcoming category icons: adapter, tile parity, defaults, overrides, transfers, suggestions and masking passed");
