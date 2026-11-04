import type { CompanionItem } from "./api";
import type { UpcomingAccountSummary, UpcomingSuggestedMove } from "./upcomingAccounts";
import { accountPaymentGap } from "./upcomingAccounts";
import { displayAccountName } from "./accountName";

type MoveItem = Pick<CompanionItem, "type" | "moves" | "plan_dest">;

function penceAmount(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  const pence = value * 100;
  return Number.isSafeInteger(Math.round(pence)) && Math.abs(pence - Math.round(pence)) <= 1e-6;
}
const positiveAmount = (value: unknown): value is number => penceAmount(value) && value > 0;
const namedId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
function liveCover(account: UpcomingAccountSummary) {
  const cover = account.position?.coveredByMove;
  if (!cover || !positiveAmount(cover.amount) || !Array.isArray(cover.from) || !cover.from.length) return null;
  if (!cover.from.every(leg => leg && positiveAmount(leg.amount) && namedId(leg.accountId) && namedId(leg.name))) return null;
  const total = cover.from.reduce((sum, leg) => sum + Math.round(leg.amount * 100), 0);
  if (!Number.isSafeInteger(total) || total !== Math.round(cover.amount * 100)) return null;
  if (cover.shortfall != null && (!penceAmount(cover.shortfall) || cover.shortfall < 0)) return null;
  if (account.position?.shortAfterCover != null && (!penceAmount(account.position.shortAfterCover) || account.position.shortAfterCover < 0)) return null;
  if (cover.shortfall != null && account.position?.shortAfterCover != null && Math.round(account.position.shortAfterCover * 100) !== Math.max(0, Math.round(cover.shortfall * 100) - Math.round(cover.amount * 100))) return null;
  return cover;
}

function validDay(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value) return null;
  const day = value.slice(0, 10);
  const date = new Date(`${day}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : null;
}

/** Live earmarks only. Never turn a recommendation into a forecast payment. */
export function suggestedMovesFor(account: UpcomingAccountSummary): UpcomingSuggestedMove[] {
  const moves: UpcomingSuggestedMove[] = [];
  const cached = Array.isArray(account.suggestedMoves) ? account.suggestedMoves : [];
  const cachedDate = (id: string) => validDay(cached.find(move => move?.id === id)?.byDate);
  const cachedName = (id: string, fallback: string) => { const name = cached.find(move => move?.id === id)?.counterpartName; return namedId(name) ? name : fallback; };
  for (const move of Array.isArray(account.position?.earmarksOut) ? account.position.earmarksOut : []) {
    if (!move || !positiveAmount(move.amount) || !namedId(move.toAccountId) || !namedId(move.toName)) continue;
    const id = `suggested:${account.id}:${move.toAccountId}`;
    moves.push({ id, counterpartId: move.toAccountId, counterpartName: cachedName(id, move.toName), amount: -move.amount, byDate: cachedDate(id) });
  }
  for (const move of liveCover(account)?.from ?? []) {
    const id = `suggested:${move.accountId}:${account.id}`;
    moves.push({ id, counterpartId: move.accountId, counterpartName: cachedName(id, move.name), amount: move.amount, byDate: validDay(account.firstShortDate) ?? cachedDate(id) });
  }
  // The engine normally coalesces these, but cached older responses may not.
  const grouped = new Map<string, UpcomingSuggestedMove>();
  for (const move of moves) {
    const key = `${move.amount < 0 ? "out" : "in"}:${move.counterpartId}`;
    const previous = grouped.get(key);
    grouped.set(key, previous ? { ...previous, amount: (Math.round(previous.amount * 100) + Math.round(move.amount * 100)) / 100 } : move);
  }
  return [...grouped.values()];
}

function withSuggestedMoves(accounts: UpcomingAccountSummary[], items: readonly MoveItem[] | null | undefined) {
  const deadlines = new Map<string, string>();
  for (const account of accounts) {
    const date = validDay(account.firstShortDate);
    if (date) deadlines.set(account.id, date);
  }
  function deadline(sourceId: string, receiverId: string, amount: number) {
    if (deadlines.has(receiverId)) return deadlines.get(receiverId)!;
    const dates: string[] = [];
    for (const item of items ?? []) {
      if (item.type !== "move" || item.plan_dest?.account_id !== receiverId) continue;
      const date = validDay(item.plan_dest.needs_by_date);
      const matching = (Array.isArray(item.moves) ? item.moves : []).filter(leg => leg?.move_map?.from?.account_id === sourceId && leg.move_map?.to?.account_id === receiverId);
      if (!date || !matching.length || !matching.every(leg => positiveAmount(leg.amount))) continue;
      const total = matching.reduce((sum, leg) => sum + Math.round(leg.amount! * 100), 0);
      if (total === Math.round(Math.abs(amount) * 100)) dates.push(date);
    }
    // Conflicting cached recommendations do not prove one deadline.
    return new Set(dates).size === 1 ? dates[0] : null;
  }
  return accounts.map(account => ({ ...account, suggestedMoves: suggestedMovesFor({ ...account, suggestedMoves: undefined }).map(move => ({
    ...move, byDate: deadline(move.amount < 0 ? account.id : move.counterpartId, move.amount < 0 ? move.counterpartId : account.id, move.amount),
    counterpartName: counterpartName(accounts, move.counterpartId, move.counterpartName),
  })) }));
}

function counterpartName(accounts: UpcomingAccountSummary[], id: string, fallback: string) {
  const account = accounts.find(candidate => candidate.id === id);
  if (!account?.bank.trim()) return fallback;
  const sameBank = accounts.filter(candidate => candidate.bank.trim().toLowerCase() === account.bank.trim().toLowerCase());
  return sameBank.length === 1 ? account.bank : `${account.bank} ${displayAccountName(account.name)}`;
}

/**
 * G266: attach the cover-plan engine's own suggested move (GET /today `move`
 * items) to the account it would cover, as data for a sentence. The app never
 * moves money, so this is only ever a recommendation. Nothing is computed here.
 */
export function withCoverSuggestions(
  accounts: UpcomingAccountSummary[],
  items: readonly MoveItem[] | null | undefined,
): UpcomingAccountSummary[] {
  const resolved = accounts.map((account) => {
    // G410: the engine's own earmark on the account position is THE source
    // (same legs and gate as the move card, so a dismissed move has none).
    // The items fallback below only serves a payload from an older API.
    const covered = liveCover(account);
    if (covered) {
      const after = account.position?.shortAfterCover ?? (covered.shortfall == null ? null : Math.max(0, covered.shortfall - covered.amount));
      if (after === null) return { ...account, coverSuggestion: undefined };
      const paymentGap = accountPaymentGap(account) ?? 0;
      const paymentResidual = Math.max(0, Math.round(paymentGap * 100) - Math.round(covered.amount * 100)) / 100;
      return {
        ...account,
        coverSuggestion: {
          amount: covered.amount,
          shortfall: Math.max(covered.shortfall ?? 0, paymentGap),
          fromName: counterpartName(accounts, covered.from[0].accountId, covered.from[0].name),
          fromCount: new Set(covered.from.map((f) => f.accountId)).size,
          shortAfterCover: Math.max(after, paymentResidual),
        },
      };
    }
    // Modern positions are authoritative. A stale item must not resurrect a
    // dismissed earmark when the new position deliberately has none.
    if (account.position) return { ...account, coverSuggestion: undefined };
    const legs = (items ?? [])
      .filter((item) => item.type === "move")
      .flatMap((item) => item.moves ?? [])
      .filter((move) => move?.move_map?.to?.account_id === account.id && namedId(move.move_map?.from?.account_id) && namedId(move.move_map?.from?.name) && positiveAmount(move.amount));
    if (!legs.length || account.status !== "short") return { ...account, coverSuggestion: undefined };
    const total = legs.reduce((sum, move) => sum + Math.round(move.amount! * 100), 0) / 100;
    if (!positiveAmount(total)) return { ...account, coverSuggestion: undefined };
    return { ...account, coverSuggestion: { amount: total, fromName: legs[0].move_map.from.name, fromCount: new Set(legs.map((move) => move.move_map.from.account_id)).size, shortAfterCover: Math.max(0, (accountPaymentGap(account) ?? 0) - total) } };
  });
  return withSuggestedMoves(resolved, items);
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
