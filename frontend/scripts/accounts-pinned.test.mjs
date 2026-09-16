// Plain-Node test for G87's A1 pinned-group behaviour ("Kevin has chosen:
// variant A, 'Quiet position', with the A1 pinned group restored"). No
// frontend test harness exists in this repo (no jest/vitest/testing-
// library) — this follows the same pattern as
// scripts/preferences-version.test.mjs: a framework-free script that
// imports the REAL production module and asserts against it.
//
// What this proves: buildEstate() (lib/accountsEstate.ts) is the ONE
// shared, pure function behind both the ratified design preview
// (app/design/accounts-canvas-before-cards) and the live AccountsPage —
// so asserting against it directly is asserting against what both render.
// A1's whole premise is that a pinned account appears BOTH in the Pinned
// band at the top of the list AND again inside its own kind-group below
// (the live page's existing behaviour, restored into the canvas-header
// variant) — this is exactly what `pinned` vs `groups[].rows` below
// checks. It does not touch Mongo, the network, or any real account.
//
// Run with:
//   node --no-warnings --experimental-strip-types scripts/accounts-pinned.test.mjs
// or:
//   npm run -s check:accounts-pinned

import { buildEstate } from "../lib/accountsEstate.ts";

let failures = 0;

function check(label, cond) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

// Two current accounts (one pinned), one savings account, one credit card —
// enough to exercise pinned-band membership, own-group membership, and
// ordering (pinned-first within a group) without needing real bank data.
const accounts = [
  {
    id: "acc-pinned-current",
    name: "Pinned Current",
    type: "Current",
    balance: 100,
    currency: "GBP",
    provider: "TestBank",
    status: "connected",
  },
  {
    id: "acc-other-current",
    name: "Other Current",
    type: "Current",
    balance: 500,
    currency: "GBP",
    provider: "TestBank",
    status: "connected",
  },
  {
    id: "acc-savings",
    name: "Savings Pot",
    type: "Savings",
    balance: 1000,
    currency: "GBP",
    provider: "TestBank",
    status: "connected",
  },
];

const pinnedIds = ["acc-pinned-current"];
const estate = buildEstate(accounts, [], pinnedIds);

// 1. The pinned account appears in the Pinned band.
const inPinnedBand = estate.pinned.some((r) => r.id === "acc-pinned-current");
check("pinned account appears in estate.pinned (the Pinned band)", inPinnedBand);

// 2. A1's deliberate duplication: the SAME account also appears inside its
// own kind-group ("Current"), not removed from there once pinned — this is
// the exact behaviour Kevin confirmed ("A pinned account appears both in
// the Pinned band and in its own group. Kevin has seen that duplication
// and accepted it.").
const currentGroup = estate.groups.find((g) => g.kind === "Current");
check("Current group exists", !!currentGroup);
const alsoInOwnGroup = !!currentGroup && currentGroup.rows.some((r) => r.id === "acc-pinned-current");
check("pinned account ALSO appears in its own group's rows (A1 duplication)", alsoInOwnGroup);

// 3. The row carries `pinned: true` in both places — this is what drives
// AccountLedgerRow's amber star (components/AccountLedgerRow.tsx: `{isPinned
// && <Star .../>}`), the "same amber ledger-row star" the G87 spec calls out.
const pinnedRowInBand = estate.pinned.find((r) => r.id === "acc-pinned-current");
check("pinned row in the band carries pinned: true", pinnedRowInBand?.pinned === true);
const pinnedRowInGroup = currentGroup?.rows.find((r) => r.id === "acc-pinned-current");
check("pinned row in its own group also carries pinned: true", pinnedRowInGroup?.pinned === true);

// 4. An unpinned account in the same group is NOT in the Pinned band.
const notPinned = estate.pinned.some((r) => r.id === "acc-other-current");
check("an unpinned account does not appear in the Pinned band", !notPinned);

// 5. Within the Current group, the pinned row sorts first (pinned-before-
// balance, per accountsEstate.ts's sortRows) even though "Other Current"
// has the larger balance (£500 vs £100) — pin order beats balance order.
check(
  "pinned row sorts first within its own group despite the smaller balance",
  currentGroup?.rows[0]?.id === "acc-pinned-current"
);

// 6. A dormant/attention account, even if pinned, is excluded from the
// Pinned band (accountsEstate.ts's own comment: "A broken/dormant account
// pinned to the top would be confusing") — the £0 dormant case from G87's
// enumerated real states.
const dormantPinnedEstate = buildEstate(
  [
    {
      id: "acc-dormant-pinned",
      name: "Old Dormant Account",
      type: "Current",
      balance: 0,
      currency: "GBP",
      provider: "TestBank",
      status: "connected",
    },
  ],
  [],
  ["acc-dormant-pinned"]
);
check(
  "a pinned but dormant (£0, inactive) account is excluded from the Pinned band",
  !dormantPinnedEstate.pinned.some((r) => r.id === "acc-dormant-pinned")
);
check(
  "that same account lands in estate.inactive instead",
  dormantPinnedEstate.inactive.some((r) => r.id === "acc-dormant-pinned")
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
}
