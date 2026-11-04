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
  if (!items?.length && !accounts.some((a) => a.position?.coveredByMove)) return accounts;
  return accounts.map((account) => {
    // G410: the engine's own earmark on the account position is THE source
    // (same legs and gate as the move card, so a dismissed move has none).
    // The items fallback below only serves a payload from an older API.
    const covered = account.position?.coveredByMove;
    if (covered && covered.amount > 0 && covered.from.length) {
      return {
        ...account,
        coverSuggestion: {
          amount: covered.amount,
          shortfall: covered.shortfall,
          fromName: covered.from[0].name,
          fromCount: new Set(covered.from.map((f) => f.accountId)).size,
          shortAfterCover: account.position?.shortAfterCover ?? 0,
        },
      };
    }
    const legs = (items ?? [])
      .filter((item) => item.type === "move")
      .flatMap((item) => item.moves ?? [])
      .filter((move) => move.move_map?.to?.account_id === account.id && typeof move.amount === "number" && move.amount > 0);
    if (!legs.length || account.status !== "short") return account;
    const total = legs.reduce((sum, move) => sum + (move.amount ?? 0), 0);
    return { ...account, coverSuggestion: { amount: total, fromName: legs[0].move_map.from.name, fromCount: new Set(legs.map((move) => move.move_map.from.account_id)).size, shortAfterCover: 0 } };
  });
}

/** One sentence, British English. */
export function coverSuggestionSentence(suggestion: NonNullable<UpcomingAccountSummary["coverSuggestion"]>): string {
  const amount = `£${suggestion.amount.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
  return suggestion.fromCount > 1
    ? `Moving ${amount} in from ${suggestion.fromCount} of your other accounts would cover it.`
    : `Moving ${amount} in from ${suggestion.fromName} would cover it.`;
}

/** G410: "Short £X, covered by the suggested move from Y." (amber, a recommendation, never an action).
 * `shortText` and `afterText` arrive already masked and formatted by the caller. */
export function coveredByMoveSentence(
  shortText: string,
  suggestion: NonNullable<UpcomingAccountSummary["coverSuggestion"]>,
  afterText?: string,
): string {
  const from = suggestion.fromCount > 1 ? `${suggestion.fromCount} of your other accounts` : suggestion.fromName;
  if (suggestion.shortAfterCover > 0 && afterText) return `Short ${afterText} after the suggested move from ${from}.`;
  return `Short ${shortText}, covered by the suggested move from ${from}.`;
}
