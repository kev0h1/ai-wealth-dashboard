// B45: plan, trial and paused-accounts copy. Pure module, no React.
import assert from "node:assert/strict";
import * as copy from "../lib/billingCopy.ts";

const strings = [
  copy.trialHeadline(14),
  copy.trialTermsLine(9.99, "every month"),
  copy.trialDisclosureLine(14, 9.99, "on 19 Oct 2026", "every month"),
  copy.trialCancelLine("before 19 Oct 2026"),
  copy.endsOnLine("2026-10-19", () => "19 Oct 2026"),
  copy.PAYMENT_FAILED_TITLE, copy.PAYMENT_FAILED_BODY, copy.FIX_PAYMENT_LABEL,
  copy.PAUSED_BANKS_TITLE, copy.pausedBanksBody(1), copy.pausedBanksBody(3), copy.RESUBSCRIBE_LABEL,
];
for (const s of strings) {
  assert.ok(!s.includes("—"), `em dash in: ${s}`);
  assert.ok(!s.includes("!"), `exclamation mark in: ${s}`);
}

assert.equal(copy.trialHeadline(14), "14-day free trial");
assert.equal(copy.trialTermsLine(9.99, "every month"), "Then £9.99 every month. Card required, cancel any time.");
assert.match(copy.trialDisclosureLine(14, 9.99, "on 19 Oct 2026", "every year"), /^14 days free, then £9\.99 on 19 Oct 2026, then £9\.99 every year unless you cancel\.$/);
assert.match(copy.trialCancelLine("before 19 Oct"), /keep your plan until the free days end/);
assert.equal(copy.endsOnLine("x", () => "19 Oct 2026"), "Ends on 19 Oct 2026");
assert.equal(copy.pausedBanksBody(1).startsWith("Your connected account is"), true);
assert.equal(copy.pausedBanksBody(2).startsWith("Your 2 connected accounts are"), true);
assert.match(copy.pausedBanksBody(2), /already synced stays here to read/);

assert.equal(copy.pausedAccountCount([{ paused: true }, { paused: false }, {}]), 1);
assert.equal(copy.pausedAccountCount([]), 0);
console.log("billing-copy: ok");
