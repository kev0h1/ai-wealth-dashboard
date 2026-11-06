/** G428: plain copy when current accounts cannot cover a shortfall alone. A
 * recommendation in words only: the app never moves money, and a savings
 * balance is never counted as spendable. Mirrors the engine's own wording
 * (backend split_cover_note) so every surface reads the same. */
export const UNCOVERED_OPTIONS = "You could edit a plan or skip a payment on Upcoming instead.";

const pounds = (value: number) => `£${Math.round(value).toLocaleString("en-GB")}`;

export type CoverSplit = { currentAmount: number; savingsAmount: number; savingsName: string };

/** `uncovered` is what stays short after every suggested move (pounds). */
export function coverSplitSentence(split: CoverSplit, uncovered = 0): string {
  const open = uncovered > 0.5;
  const lead = split.currentAmount > 0 ? `Your other accounts can cover ${pounds(split.currentAmount)}. ` : "";
  // The name is a label used as is ("your Barclays savings"); never capitalised inside a sentence.
  const move = `A move of ${pounds(split.savingsAmount)} from ${split.savingsName}`;
  if (split.currentAmount > 0) {
    return open ? `${lead}${move} would cover more, but ${pounds(uncovered)} is still uncovered. ${UNCOVERED_OPTIONS}` : `${lead}${move} would cover the rest.`;
  }
  return open ? `${move} would cover part of it, but ${pounds(uncovered)} is still uncovered. ${UNCOVERED_OPTIONS}` : `${move} would cover it.`;
}

/** The plain line when suggested moves leave some of the gap uncovered and no savings is involved. */
export function uncoveredSentence(uncovered: number): string {
  return `${pounds(uncovered)} is still uncovered. ${UNCOVERED_OPTIONS}`;
}
