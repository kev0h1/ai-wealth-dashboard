import { upcomingCategoryAppearance } from "@/components/upcoming/UpcomingCategoryIcon";
const { Icon: BillsIcon, colour: billsColour } = upcomingCategoryAppearance("Bills", "bill", {}, {});
import type { Account, CompanionItem, PlannedExpense } from "@/lib/api";
import type { UpcomingRowModel } from "@/components/upcoming/UpcomingRow";

/** Invented, local-only figures for C22 capability captures. */
export const CAPABILITY_ACCOUNTS: Account[] = [
  { id: "alex-everyday", name: "Everyday account", provider: "Monzo", type: "bank", subtype: "CURRENT", balance: 542, currency: "GBP", status: "connected" },
  { id: "alex-joint", name: "Joint account", provider: "Nationwide", type: "bank", subtype: "CURRENT", balance: 310, currency: "GBP", status: "connected" },
  { id: "alex-bills", name: "Bills account", provider: "Barclays", type: "bank", subtype: "CURRENT", balance: 68, currency: "GBP", status: "connected" },
];

export const COVER_SUGGESTION: CompanionItem = {
  id: "alex-cover-energy-november",
  type: "move",
  headline: "Move £120 to cover your bills account",
  body: "Your bills account needs £120 for Energy on 14 November.",
  action: { label: "Review the move", route: "/upcoming" },
  estimated: false,
  amount: 120,
  covered: true,
  sources_safe: true,
  moves: [
    {
      headline: "Move £80 from Everyday account",
      amount: 80,
      move_map: {
        from: { account_id: "alex-everyday", name: "Everyday account", provider: "Monzo", balance: 542, safe_note: "£80 available after this account's own bills and plans" },
        to: { account_id: "alex-bills", name: "Bills account", provider: "Barclays", balance: 68, incoming: "£120 to add" },
      },
    },
    {
      headline: "Move £40 from Joint account",
      amount: 40,
      move_map: {
        from: { account_id: "alex-joint", name: "Joint account", provider: "Nationwide", balance: 310, safe_note: "£40 available after this account's own bills and plans" },
        to: { account_id: "alex-bills", name: "Bills account", provider: "Barclays", balance: 68, incoming: "£120 to add" },
      },
    },
  ],
  plan_dest: {
    account_id: "alex-bills",
    name: "Bills account",
    provider: "Barclays",
    balance: 68,
    needs_total: 188,
    needs_by: "14 Nov",
    needs_by_date: "2026-11-14",
    bills: [{ label: "Energy", amount: 188, expected_date: "2026-11-14" }],
  },
  cover_note: "Suggested split: £80 from Everyday and £40 from Joint. You make the transfers in your bank.",
};

export const COVER_HEADROOM_EVIDENCE = [
  { account: "Everyday account", balance: 542, headroom: 80 },
  { account: "Joint account", balance: 310, headroom: 40 },
] as const;

export const UPCOMING_ROWS: UpcomingRowModel[] = [
  {
    rowKey: "energy-14-nov", type: "bill", name: "Energy", amount: 188, expectedDate: "2026-11-14",
    accountLabel: "Everyday account", accountBalance: 542,
    coverage: { shortfall: 0, before: 542, after: 354 }, after: { kind: "balance", value: 732 },
    category: "Bills", categoryColour: billsColour, CategoryIcon: BillsIcon,
  },
  {
    rowKey: "broadband-16-nov", type: "bill", name: "Broadband", amount: 38, expectedDate: "2026-11-16",
    accountLabel: "Everyday account", accountBalance: 542, coverage: { shortfall: 0, before: 354, after: 316 }, after: { kind: "balance", value: 694 },
    category: "Bills", categoryColour: billsColour, CategoryIcon: BillsIcon,
  },
];

export const BOILER_SERVICE: PlannedExpense = {
  id: "alex-boiler-service", name: "Boiler service", amount: 90, date: "2026-11-24", account_id: "alex-everyday",
};

export const UPDATED_BOILER_SERVICE: PlannedExpense = {
  ...BOILER_SERVICE, amount: 95, date: "2026-11-26",
};

export function plannedRow(item: PlannedExpense): UpcomingRowModel {
  return {
    rowKey: item.id,
    type: "bill",
    name: item.name,
    amount: item.amount,
    expectedDate: item.date,
    accountLabel: "Everyday account",
    accountBalance: 542,
    isPlanned: true,
    coverage: { shortfall: 0, before: 316, after: 316 - item.amount },
    after: { kind: "balance", value: 694 - item.amount },
    category: "Bills", categoryColour: billsColour, CategoryIcon: BillsIcon,
  };
}
