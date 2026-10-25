// G325 proposal only. Move into lib/ only after a design is approved.
import type { Account, AccountEligibility } from "@/lib/api";
import { sourceClass } from "@/lib/coverPlanSourceClass";
import { bestSpendAccount, type SpendFromAccount } from "@/lib/spendFromAccount";

export type OtherAccount = { account: Account; limit: SpendFromAccount | null; reason: string | null };

export function accountReason(entry?: AccountEligibility): string {
  if (!entry) return "Account check not available.";
  if (entry.uncertain) return "Payments and plans could not be checked together.";
  if ((entry.low_point_and_plans ?? 1) <= 0) return "Nothing spare at its lowest point before payday.";
  if ((entry.after_payments_and_plans ?? 1) <= 0) return "Nothing spare after its payments and plans.";
  if ((entry.spend_from_headroom ?? entry.headroom) > 0) return "Below the minimum account limit shown here.";
  return "No account limit available right now.";
}

export function accountListModel(accounts: Account[], eligibility: Record<string, AccountEligibility>, variant: "a" | "b") {
  // Reuse the shipped admission, floor and ranking rules; raw balances never
  // become limits. Missing eligibility is retained as an unknown row, not £0.
  const counted = accounts.filter(a => a.include_in_safe_to_spend !== false && a.cover_source_eligible !== false && sourceClass(a) === "current" && a.currency === "GBP");
  const usable = counted.flatMap(account => {
    const result = bestSpendAccount(eligibility, [account]);
    return result.kind === "account" ? [result.best] : [];
  }).sort((a, b) => b.headroom - a.headroom);
  const visible = variant === "a" ? usable.slice(0, 2) : usable;
  const ids = new Set(visible.map(e => e.accountId));
  const others: OtherAccount[] = counted.filter(a => !ids.has(a.id)).map(account => ({
    account,
    limit: usable.find(e => e.accountId === account.id) ?? null,
    reason: usable.some(e => e.accountId === account.id) ? null : accountReason(eligibility[account.id]),
  }));
  return { visible, others, hasOtherRoom: others.some(e => e.limit !== null) };
}
