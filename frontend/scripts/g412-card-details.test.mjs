// G412: keeps the card details record payment-first without inventing money.
// Run: npm run -s check:g412-card-details
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sheet = readFileSync(new URL("../components/CardTermsSheet.tsx", import.meta.url), "utf8");
const accounts = readFileSync(new URL("../app/components/AccountsPage.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8");

assert.match(sheet, /const bill = current\?\.statement_bill;/, "the server-derived bill is rendered directly");
assert.match(sheet, /amount == null \? "Not recorded"/, "an unknown amount never becomes £0");
assert.match(sheet, /Estimated statement bill/, "the statement estimate leads the payment record");
assert.match(sheet, /spending_since_close/, "post-close spend remains separate from the statement bill");
assert.match(sheet, /paymentMethod === "full" \? "clear_monthly" : paymentMethod === "minimum" \|\| paymentMethod === "fixed" \? "carry" : null/, "manual payment makes no repayment assumption");
assert.match(sheet, /No account recorded/, "the optional payment source can be cleared");
assert.doesNotMatch(sheet, /<select\b/, "payment details use app-styled choices, not a native select");
assert.doesNotMatch(sheet, /type="(?:date|month)"/, "statement dates use the app day picker");
assert.match(accounts, /account\.status !== "expired"/, "only connected payment accounts can be selected");
assert.match(accounts, /accountKind\(account\) === "Current"\)/, "savings cannot pay a card: the route rejects them");
assert.doesNotMatch(accounts, /\["Current", "Savings"\]/, "no savings payer offered");
assert.match(sheet, /No connected current account is available to choose\./, "empty copy names current accounts only");
assert.match(accounts, /account\.include_in_safe_to_spend !== false/, "excluded accounts cannot be selected");
assert.match(api, /export type CardStatementBill/, "the API documents the server bill response");
assert.match(api, /statement_bill\?: CardStatementBill \| null/, "older cached responses remain valid");
// G413: the optional match rule lives in the same section, needs the paying account, and says what it does in plain words.
assert.match(sheet, /Which payment is this bill\?/, "the rule question is in the payment section");
assert.match(sheet, /paymentAccountId && matchKind === "contains"/, "a rule is only sent with a paying account");
assert.match(sheet, /payment_match: paymentMatch/, "the rule is saved with the other payment fields");
assert.match(sheet, /getCardPayerPayments\(currentId, paymentAccountId\)/, "picking reads the paying account's recent payments");
assert.doesNotMatch(sheet, /No rule[^<]*!|Contains text[^<]*!/, "no exclamation marks");
assert.match(api, /payment_match\?: CardPaymentMatch \| null/, "the API type carries the rule");
assert.match(api, /rule_status\?: "matched" \| "unmatched" \| "unknown"/, "the bill carries the quiet rule status");
console.log("g412-card-details: ok");
