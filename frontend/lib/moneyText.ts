/**
 * Pure tokenising logic behind components/MoneyText.tsx, split out so it can
 * be unit-tested with a plain Node script (this repo has no jest/vitest;
 * see scripts/*.test.mjs for the established framework-free pattern) — a
 * .tsx file with JSX in it can't be imported directly by
 * `node --experimental-strip-types`, which only strips types, not JSX.
 *
 * Money is mono: anything carrying a £ renders in JetBrains Mono with
 * tabular figures, all other text stays in Figtree. Matches any of ~£,
 * −£ (Unicode minus), -£, +£, or bare £ followed by either a run of
 * digits (with an optional k/m abbreviation suffix, e.g. £340k, £1.20m)
 * or a run of mask bullets (e.g. £•••• from maskAmounts() when the
 * hide-balances preference is on), so it never grabs dates, percentages,
 * or plain counts, and never falls through to Figtree just because the
 * figure is masked or abbreviated.
 *
 * The digit run is `\d+(?:,\d+)*`, not the flatter `[\d,]+`
 * (G112, 2026-09-16): a comma is only ever part of the number when it is
 * followed by more digits, e.g. £1,175. A trailing comma that is just
 * sentence punctuation, e.g. "you have £180, which covers it", is left
 * outside the match instead of being swallowed into the mono run. A full
 * stop was never swallowed either way, since the decimal group
 * `(?:\.\d+)?` already only matches a `.` that is itself followed by a
 * digit.
 */
export const CURRENCY_TOKEN = /([~−+-]?£(?:\d+(?:,\d+)*(?:\.\d+)?[km]?|•+))/gi;
const CURRENCY_TOKEN_EXACT = /^[~−+-]?£(?:\d+(?:,\d+)*(?:\.\d+)?[km]?|•+)$/i;

export function isCurrencyToken(part: string): boolean {
  return CURRENCY_TOKEN_EXACT.test(part);
}

/**
 * Splits `text` into alternating non-money / money parts, same contract as
 * `text.split(CURRENCY_TOKEN)` with a capturing group: money tokens land at
 * odd indices, but callers should use `isCurrencyToken` rather than index
 * parity to classify a part, exactly as MoneyText itself does.
 */
export function splitMoneyText(text: string): string[] {
  return text.split(CURRENCY_TOKEN);
}

/**
 * Whether `text` contains at least one currency token. `.match()` with a
 * /g regex always scans from index 0 and leaves no lastIndex state behind,
 * unlike `.test()`, which would otherwise corrupt the shared module-level
 * CURRENCY_TOKEN across calls.
 */
export function hasMoneyToken(text: string): boolean {
  return text.match(CURRENCY_TOKEN) !== null;
}
