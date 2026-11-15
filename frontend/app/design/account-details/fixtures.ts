/** G474: independently invented accounts and dates. No connected records. */
export type AccountKind = "current" | "savings" | "credit";
export type ConnectionState = "healthy" | "reconnect" | "never";
export type Variant = "a" | "b" | "c";
export type Example = "normal" | "locked" | "missing" | "long" | "failure";
export type Child = "identity" | "connection" | "payment" | "rates" | "remove" | "reconnect" | null;

export interface FixtureAccount {
  kind: AccountKind; name: string; bank: string; product: string;
  last4: string | null; sortCode: string | null; balance: number;
}
export const ACCOUNTS: Record<AccountKind, FixtureAccount> = {
  current: { kind: "current", name: "Day-to-day", bank: "Harbour Bank", product: "Everyday current account", last4: "6382", sortCode: "20-16-04", balance: 2347.65 },
  savings: { kind: "savings", name: "Rainy day", bank: "Moorland Bank", product: "Easy access saver", last4: "9176", sortCode: "40-18-62", balance: 6821.40 },
  credit: { kind: "credit", name: "Travel card", bank: "Northbridge", product: "Rewards credit card", last4: "2849", sortCode: null, balance: -1736.28 },
};
export const VARIANTS = {
  a: { name: "Account passport", summary: "One compact sheet, a clear identity anchor and a consistent row for each control. Connection evidence opens in its own sheet.", tradeoff: "Fast to scan. Detailed connection evidence takes one more tap." },
  b: { name: "Clear groups", summary: "Account controls sit together. A separate connection section keeps its evidence and refresh action in place.", tradeoff: "More context stays visible. The card example needs a little more scrolling." },
  c: { name: "Connection first", summary: "The current connection state leads after identity, with the relevant repair action before everyday controls.", tradeoff: "Recovery is hard to miss. Healthy connections get more space than in A." },
} satisfies Record<Variant, { name: string; summary: string; tradeoff: string }>;
export const STATE_NAMES: Record<ConnectionState, string> = { healthy: "Healthy", reconnect: "Needs reconnecting", never: "Never synced" };
export const HEURISTICS = [
  ["Status visibility", 2], ["Plain-language match", 3], ["Control and freedom", 3], ["Consistency", 2], ["Error prevention", 3],
  ["Recognition", 1], ["Efficiency", 2], ["Minimalism", 2], ["Recovery", 3], ["Help", 1],
] as const;

export interface Model {
  account: FixtureAccount; state: ConnectionState; example: Example; hidden: boolean;
  included: boolean; pinned: boolean; busy: "pin" | "refresh" | null;
  refreshed: boolean; pinError: boolean; refreshError: boolean; notice: string;
  paymentMethod: "full" | "minimum" | "manual";
}
export interface Actions {
  open: (child: Exclude<Child, null>) => void;
  togglePin: () => void; toggleIncluded: () => void; refresh: () => void;
}
export interface VariantProps { model: Model; actions: Actions }

export function connectionTitle(model: Pick<Model, "state" | "refreshed">): string {
  return model.state === "reconnect" ? "Reconnect to update this account" : model.state === "never" ? "Waiting for the first update" : "Your connection is working";
}
export function connectionCaption(model: Pick<Model, "state" | "refreshed">): string {
  return model.state === "reconnect" ? "Bank updates have stopped. Your last recorded details are still here."
    : model.state === "never" ? "Your bank is connected. The first balance and transactions have not arrived yet."
    : model.refreshed ? "Updated just now. Your next refresh is available at 12:15." : "Bank data from 15 Nov 2026 at 10:24.";
}
