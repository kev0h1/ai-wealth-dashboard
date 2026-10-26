import { fixture as originalFixture } from "@/scripts/fixtures/g342-pay-split";
import type { MoneyShape } from "@/lib/api";
import { money, type Comparison, type SectionId } from "@/lib/paySplitReference";

export const EXAMPLES = [
  { id: "kevin", name: "Your example" },
  { id: "outside", name: "Outside the ranges" },
  { id: "left", name: "Income left over" },
  { id: "equal", name: "Total matches income" },
  { id: "rounding", name: "Small rounding amount" },
  { id: "transfers", name: "Transfers included" },
  { id: "refund", name: "Refund included" },
  { id: "missing-evidence", name: "Missing category detail" },
  { id: "large", name: "Large figures" },
  { id: "no-income", name: "No income" },
  { id: "loading", name: "Loading" },
  { id: "save-error", name: "Choice not saved" },
] as const;
export type Example = typeof EXAMPLES[number]["id"];
export function fixture(example: Example): MoneyShape {
  const shape = originalFixture(example === "outside" || example === "left" || example === "large" || example === "no-income" ? example : "kevin");
  const exact = example !== "outside" && example !== "left" && example !== "large";
  if (exact) for (const job of shape.jobs ?? []) {
    if (job.id === "fixed") job.drivers = example === "refund"
      ? [{ category: "Bills", amount: 1000 }, { category: "Mortgage", amount: 1700 }, { category: "Transport", amount: 170.93 }, { category: "Groceries refund", amount: -40 }]
      : [{ category: "Mortgage", amount: 1100 }, { category: "Bills", amount: 900 }, { category: "Groceries", amount: 500 }, { category: "Transport", amount: 330.93 }];
    if (job.id === "moved") job.drivers = example === "transfers"
      ? [{ category: "Savings", amount: 300 }, { category: "Investment", amount: 100 }, { category: "Transfer", amount: 500 }, { category: null, amount: 41.81 }]
      : example === "rounding"
        ? [{ category: "Savings", amount: 650 }, { category: "Investment", amount: 291.77 }, { category: null, amount: .04 }]
        : [{ category: "Savings", amount: 650 }, { category: "Investment", amount: 291.81 }];
    if (job.id === "free") job.drivers = [{ category: "Shopping", amount: 800 }, { category: "Meals out", amount: 500 }, { category: "Other", amount: 277.79 }];
    if (example === "missing-evidence" && job.id === "moved") job.drivers = undefined;
  }
  if (example === "equal") {
    shape.total_out = shape.take_home;
    shape.beyond = 0;
    shape.overspent = 0;
    for (const job of shape.jobs ?? []) {
      if (job.id === "fixed") { job.amount = 3901.87; job.drivers = [{ category: "Bills and basics", amount: 3901.87 }]; }
      if (job.id === "free") { job.amount = 0; job.drivers = []; }
    }
  }
  return shape;
}

const pennies = (value: number) => Math.round(value * 100);
export function categoryEvidence(shape: MoneyShape, id: SectionId) {
  const job = shape.jobs?.find(item => item.id === id);
  const drivers = job?.drivers;
  if (!job || !drivers || drivers.some(row => !Number.isFinite(row.amount)) || drivers.reduce((sum, row) => sum + pennies(row.amount), 0) !== pennies(job.amount)) {
    return { available: false, rows: [], smallAmount: 0 };
  }
  const small = drivers.filter(row => row.category === null && Math.abs(row.amount) < 1);
  return { available: true, rows: drivers.filter(row => !small.includes(row)), smallAmount: small.reduce((sum, row) => sum + pennies(row.amount), 0) / 100 };
}

export function flowText(comparison: Comparison): string {
  return comparison.beyond > 0 ? "This is " + money(comparison.beyond) + " more than your income."
    : comparison.left > 0 ? "This is " + money(comparison.left) + " less than your income."
    : "The total matches your income.";
}
