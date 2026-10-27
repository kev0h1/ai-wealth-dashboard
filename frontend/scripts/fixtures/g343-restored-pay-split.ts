// Synthetic data for the restored layout, including Kevin's screenshot amounts.
import { fixture as baseFixture, type Example } from "./g342-pay-split";
import type { MoneyShape } from "@/lib/api";
export type RestoredExample = Example | "historic" | "refund" | "missing-evidence";

export function restoredFixture(example: RestoredExample): MoneyShape {
  const shape = baseFixture(example === "historic" || example === "refund" || example === "missing-evidence" ? "kevin" : example);
  if (example === "historic") {
    const amounts = { fixed: 152.65, moved: .05, free: 303, left: 5.32 };
    shape.take_home = 461.02;
    shape.total_out = 455.70;
    shape.beyond = shape.overspent = 0;
    shape.jobs = shape.jobs!.map(job => ({
      ...job, amount: amounts[job.id], share: amounts[job.id] / shape.take_home * 100,
      drivers: job.id === "left" ? undefined : [{ category: job.id === "fixed" ? "Bills and groceries" : job.id === "moved" ? "Savings" : "Shopping and meals out", amount: amounts[job.id] }],
    }));
  }
  if (example === "refund") shape.jobs!.find(job => job.id === "fixed")!.drivers = [
    { category: "Bills", amount: 2870.93 }, { category: "Groceries refund", amount: -40 },
  ];
  if (example === "missing-evidence") shape.jobs!.find(job => job.id === "fixed")!.drivers = undefined;
  for (const job of shape.jobs ?? []) {
    job.label = job.id === "fixed" ? "Fixed (bills, debt, rent)" : job.id === "moved" ? "Moved to savings" : job.id === "free" ? "Free spending" : "Left over";
  }
  return shape;
}
