import type { CompanionItem } from "./api";
import type { UpcomingAccountSummary } from "./upcomingAccounts";

/**
 * G266: attach the cover-plan engine's own suggested move (GET /today `move`
 * items) to the account it would cover, as data for a sentence. The app never
 * moves money, so this is only ever a recommendation. Nothing is computed here.
 */
export function withCoverSuggestions(
  accounts: UpcomingAccountSummary[],
  items: readonly Pick<CompanionItem, "type" | "moves">[] | null | undefined,
): UpcomingAccountSummary[] {
  if (!items?.length) return accounts;
  return accounts.map((account) => {
    if (account.status !== "short") return account;
    const legs = items
      .filter((item) => item.type === "move")
      .flatMap((item) => item.moves ?? [])
      .filter((move) => move.move_map?.to?.account_id === account.id && typeof move.amount === "number" && move.amount > 0);
    if (!legs.length) return account;
    const total = legs.reduce((sum, move) => sum + (move.amount ?? 0), 0);
    return { ...account, coverSuggestion: { amount: total, fromName: legs[0].move_map.from.name, fromCount: new Set(legs.map((move) => move.move_map.from.account_id)).size } };
  });
}

/** One sentence, British English. */
export function coverSuggestionSentence(suggestion: NonNullable<UpcomingAccountSummary["coverSuggestion"]>): string {
  const amount = `£${suggestion.amount.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
  return suggestion.fromCount > 1
    ? `Moving ${amount} in from ${suggestion.fromCount} of your other accounts would cover it.`
    : `Moving ${amount} in from ${suggestion.fromName} would cover it.`;
}
