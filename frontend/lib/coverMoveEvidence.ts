import type { Account, AccountEligibility } from "@/lib/api";
import { displayAccountName } from "@/lib/accountName";

export type CoverMoveEvidence = { sourceId: string; sourceName: string; destinationId: string; destinationName: string; amount: number };

/** Information, not another deduction. Require the SAME visible move and
 * server earmark to agree before naming a source, destination or amount. */
export function coverMoveEvidence(
  accounts: Account[], positions: Record<string, AccountEligibility> | undefined,
  visible: boolean, reserves: Record<string, number>,
): CoverMoveEvidence[] {
  if (!visible || !positions) return [];
  const names = new Map(accounts.map(a => [a.id, displayAccountName(a.name)]));
  const result: CoverMoveEvidence[] = [];
  for (const [sourceId, amount] of Object.entries(reserves)) {
    const sourceName = names.get(sourceId);
    const position = positions[sourceId];
    const legs = position?.earmarks_out;
    if (!sourceName || position?.uncertain || !legs?.length || !Number.isFinite(amount) || amount <= 0) continue;
    if (legs.some(leg => !leg.to_account_id || !leg.to_name?.trim() || !Number.isFinite(leg.amount) || leg.amount <= 0)) continue;
    const pennies = Math.round(legs.reduce((total, leg) => total + leg.amount, 0) * 100);
    if (pennies !== Math.round(amount * 100) || Math.round((position.earmarked_total ?? 0) * 100) !== pennies) continue;
    for (const leg of legs) result.push({ sourceId, sourceName, destinationId: leg.to_account_id,
      destinationName: displayAccountName(leg.to_name), amount: leg.amount });
  }
  return result;
}
