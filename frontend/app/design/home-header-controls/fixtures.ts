// Fictional, fixed Home context. G491 varies the header only, so both options
// use the same content, figures and reading order. There are no API calls.
export const HOME = {
  firstName: "Alex",
  initials: "AM",
  longName: "Alexandria-Jane",
  payday: "30 Nov",
  estimate: 640,
  cash: 2050,
  bills: 1010,
  plans: 200,
  buffer: 200,
  accounts: [
    { name: "Personal account", provider: "Barclays", balance: 1540, available: 400 },
    { name: "Bills account", provider: "Monzo", balance: 510, available: 240 },
  ],
  transactions: [
    { name: "Sainsbury’s", category: "Groceries", icon: "shopping-cart", amount: -42.10, date: "Today" },
    { name: "Transport for London", category: "Transport", icon: "train", amount: -6.80, date: "Yesterday" },
    { name: "Local coffee", category: "Eating Out", icon: "coffee", amount: -4.20, date: "Yesterday" },
  ],
} as const;

export const STATES = [
  { value: "ready", label: "Loaded profile" },
  { value: "loading", label: "Name and initials loading" },
  { value: "hidden", label: "Balances hidden" },
  { value: "long", label: "Long first name" },
  { value: "unnamed", label: "No name on profile" },
] as const;

export type PreviewState = typeof STATES[number]["value"];

export function previewState(value: string): PreviewState {
  return STATES.find(state => state.value === value)?.value ?? "ready";
}

export function money(value: number, hidden: boolean, exact = false) {
  const sign = value < 0 ? "−" : "";
  return `${sign}${hidden ? "£••••" : new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: exact ? 2 : 0,
    maximumFractionDigits: exact ? 2 : 0,
  }).format(Math.abs(value))}`;
}
