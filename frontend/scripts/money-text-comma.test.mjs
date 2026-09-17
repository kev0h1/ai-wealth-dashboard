// Plain-Node test for MoneyText's currency tokenising regex (G112,
// 2026-09-16). Same framework-free pattern as scripts/serial-queue.test.mjs
// and scripts/legal-content.test.mjs: this repo has no jest/vitest, and a
// .tsx component can't be imported directly by
// `node --experimental-strip-types` because that flag only strips types,
// not JSX — so the regex + split/classify helpers live in the JSX-free
// lib/moneyText.ts and this test imports from there.
//
// Bug this guards: the old digit-run pattern was `[\d,]+`, which is
// thousands-separator aware but treats a comma as part of the number no
// matter what follows it. A sentence like "you have £180, which covers
// it" matched "£180," as a single currency token, so the sentence comma
// rendered inside the mono <span>, visibly mis-kerned against the
// surrounding Figtree prose. Run this file both before and after the fix
// to see it flip (see the PASS/FAIL block pasted in the backlog note).
//
// Run with:
//   node --no-warnings --experimental-strip-types scripts/money-text-comma.test.mjs
// or:
//   npm run -s check:money-text-comma

import { splitMoneyText, isCurrencyToken, hasMoneyToken } from "../lib/moneyText.ts";

let failures = 0;

function check(label, cond) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

// Returns the currency tokens found in `text`, in order, so tests can
// assert on exactly what MoneyText would wrap in a mono <span>.
function moneyTokens(text) {
  return splitMoneyText(text).filter((part) => isCurrencyToken(part));
}

function testFigureFollowedByComma() {
  const text = "you have £180, which covers it";
  const tokens = moneyTokens(text);
  check("comma: exactly one money token", tokens.length === 1);
  check("comma: token is £180 without the trailing comma", tokens[0] === "£180");
  check("comma: full split does not fuse the comma into the money part", !splitMoneyText(text).includes("£180,"));
  // The comma must still be present in the output overall, just outside
  // the money span, or the rendered sentence would lose punctuation.
  check("comma: rejoined parts reproduce the original text", splitMoneyText(text).join("") === text);
}

function testFigureFollowedByFullStop() {
  const text = "That leaves £45.";
  const tokens = moneyTokens(text);
  check("full stop: exactly one money token", tokens.length === 1);
  check("full stop: token is £45 without the trailing full stop", tokens[0] === "£45");
  check("full stop: rejoined parts reproduce the original text", splitMoneyText(text).join("") === text);
}

function testFigureFollowedByFullStopThenDigits() {
  // A genuine decimal amount must still fuse the full stop into the token
  // — only a *trailing* full stop (not followed by a digit) is excluded.
  const text = "That leaves £45.50 in the pot.";
  const tokens = moneyTokens(text);
  check("decimal: exactly one money token", tokens.length === 1);
  check("decimal: token keeps the decimal point and pence", tokens[0] === "£45.50");
}

function testGenuineThousandsSeparator() {
  const text = "Your mortgage balance is £1,175 today";
  const tokens = moneyTokens(text);
  check("thousands: exactly one money token", tokens.length === 1);
  check("thousands: £1,175 renders as one token", tokens[0] === "£1,175");
}

function testThousandsSeparatorFollowedByComma() {
  // The combination that motivated this ticket: a genuine thousands
  // separator earlier in the number, then a sentence comma right after it.
  const text = "you have £1,175, which covers it";
  const tokens = moneyTokens(text);
  check("thousands+comma: exactly one money token", tokens.length === 1);
  check("thousands+comma: token keeps the thousands separator only", tokens[0] === "£1,175");
}

function testMultipleThousandsGroups() {
  const text = "The portfolio is worth £12,345,678 as of today";
  const tokens = moneyTokens(text);
  check("multi-group thousands: exactly one money token", tokens.length === 1);
  check("multi-group thousands: keeps every group", tokens[0] === "£12,345,678");
}

function testAbbreviatedAndMaskedStillWork() {
  check("abbreviation: £340k is still a token", isCurrencyToken("£340k"));
  check("abbreviation: £1.20m is still a token", isCurrencyToken("£1.20m"));
  check("masked: £•••• is still a token", isCurrencyToken("£••••"));
  check("negative: −£50 is still a token", isCurrencyToken("−£50"));
  check("hasMoneyToken: true for a sentence containing a figure", hasMoneyToken("you owe £30 today"));
  check("hasMoneyToken: false for a sentence with no currency figure", !hasMoneyToken("nothing to see here"));
}

testFigureFollowedByComma();
testFigureFollowedByFullStop();
testFigureFollowedByFullStopThenDigits();
testGenuineThousandsSeparator();
testThousandsSeparatorFollowedByComma();
testMultipleThousandsGroups();
testAbbreviatedAndMaskedStillWork();

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log("\nAll checks passed");
}
