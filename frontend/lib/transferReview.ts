// Payload shared by the transfer review API and its production sheet.
import type { TransferPairSuggestion } from "@/lib/api";
export type MiscategorisedMember = {
  id: string;
  date: string;
  amount: number;
  account_id: string;
  description: string | null;
  merchant_name: string | null;
};

export type MiscategorisedItem = {
  id: string;
  ids: string[];
  count: number;
  series_key: string;
  merchant_name: string | null;
  description: string | null;
  amount: number;
  amount_min: number | null;
  amount_max: number | null;
  date: string;
  first_date: string | null;
  currency: string;
  category: string | null;
  transaction_type: string;
  // account_id/members — optional/additive, absent on a payload cached
  // before the backend started sending them.
  account_id?: string;
  members?: MiscategorisedMember[];
  // Real per-row evidence for why this was flagged as an own-transfer —
  // optional/additive, absent on a payload cached before this field existed.
  reason?: { kind: "name" } | { kind: "account"; account_id: string };
};

/** Advance a series locally after a saved single-payment choice. The API caps
 * its member evidence, so an exhausted page must offer a deliberate load of
 * the remaining payments rather than claiming the whole series was checked. */
export function remainingReviewItem(item: MiscategorisedItem, resolved: ReadonlySet<string>): MiscategorisedItem | null {
  const ids = item.ids.filter(id => !resolved.has(id));
  if (!ids.length) return null;
  if (!resolved.has(item.id)) return { ...item, ids, count: ids.length };
  const next = item.members?.find(member => ids.includes(member.id));
  if (!next) return null;
  return { ...item, ...next, ids, count: ids.length };
}


const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** G442: every pair one answer to this suggestion covers. A suggestion with no
 * series (an older payload) covers only itself. */
export function seriesPairs(pair: TransferPairSuggestion): { pair_key: string; credit_id: string; debit_id: string }[] {
  const listed = pair.series?.pairs;
  if (listed && listed.length) return listed;
  return [{ pair_key: pair.pair_key, credit_id: pair.credit.id, debit_id: pair.debit.id }];
}

/** G442: "3 times since Sep", or null for a single payment. Read from the ISO
 * text, never through a timezone, so the month cannot slip. */
export function seriesSinceLabel(count: number, firstDate?: string | null): string | null {
  if (count < 2) return null;
  const month = MONTHS[Number(String(firstDate ?? "").slice(5, 7)) - 1];
  return month ? `${count} times since ${month}` : `${count} times`;
}

/** G442: the suggestions left once the answered pair keys are removed. */
export function withoutAnswered(pairs: TransferPairSuggestion[], answeredKeys: ReadonlySet<string>): TransferPairSuggestion[] {
  return pairs.filter(pair => !answeredKeys.has(pair.pair_key));
}
