export type Bank = "Barclays" | "HSBC" | "NatWest" | "Monzo" | "Starling" | "Amex" | "Offline" | "Nationwide" | "Santander";
export type Kind = "Current" | "Savings" | "Pot" | "Credit" | "Offline";

export type PreviewAccount = {
  id: string; bank: Bank; name: string; kind: Kind; balance?: number; available?: number;
  pinned?: boolean; dormant?: boolean; notCounted?: boolean; status?: "syncing" | "unknown"; payments?: number; plans?: number; low?: number; buffer?: number;
};

// Deliberately synthetic review data. Values are precomputed fixtures, never a customer feed.
export const accounts: PreviewAccount[] = [
  { id: "barclays-everyday", bank: "Barclays", name: "Everyday Current", kind: "Current", balance: 1250, available: 400, pinned: true, payments: 620, plans: 150, low: 480, buffer: 80 },
  { id: "barclays-travel", bank: "Barclays", name: "Travel saver", kind: "Savings", balance: 860 },
  { id: "hsbc-pay", bank: "HSBC", name: "Pay account", kind: "Current", balance: 259, available: 0, pinned: true, payments: 548, plans: 0, low: -289, buffer: 0 },
  { id: "hsbc-bills", bank: "HSBC", name: "Bills account", kind: "Current", balance: 920, available: 280, payments: 450, plans: 120, low: 350, buffer: 70 },
  { id: "hsbc-card", bank: "HSBC", name: "Cashback card", kind: "Credit", balance: -96 },
  { id: "natwest-home", bank: "NatWest", name: "Home current", kind: "Current", balance: 1520, available: 690, payments: 600, plans: 150, low: 770, buffer: 80 },
  { id: "natwest-rainy", bank: "NatWest", name: "Rainy day saver", kind: "Savings", balance: 6400 },
  { id: "natwest-old", bank: "NatWest", name: "Old saver", kind: "Savings", balance: 0, dormant: true },
  { id: "monzo-personal", bank: "Monzo", name: "Personal", kind: "Current", balance: 480, available: 215, payments: 190, plans: 40, low: 250, buffer: 35 },
  { id: "monzo-holiday", bank: "Monzo", name: "Holiday pot", kind: "Pot", balance: 760 },
  { id: "monzo-bills", bank: "Monzo", name: "Bills pot", kind: "Pot", balance: 340 },
  { id: "monzo-flex", bank: "Monzo", name: "Flex", kind: "Credit", balance: -96 },
  { id: "starling-joint", bank: "Starling", name: "Joint current", kind: "Current", balance: 940, available: 410, payments: 360, plans: 100, low: 480, buffer: 70 },
  { id: "starling-household", bank: "Starling", name: "Household space", kind: "Pot", balance: 1200 },
  { id: "amex-gold", bank: "Amex", name: "Gold card", kind: "Credit", balance: -1210, pinned: true },
  { id: "amex-platinum", bank: "Amex", name: "Platinum card", kind: "Credit", balance: -84 },
  { id: "offline-repairs", bank: "Offline", name: "Repairs fund", kind: "Offline", balance: 2200 },
  { id: "barclays-legacy", bank: "Barclays", name: "Legacy saver", kind: "Savings", balance: 0, dormant: true },
  { id: "halifax-excluded", bank: "Barclays", name: "Long-term saver", kind: "Savings", balance: 620, notCounted: true },
  { id: "starling-everyday", bank: "Starling", name: "Everyday current", kind: "Current", balance: 490, available: 200, payments: 200, plans: 60, low: 230, buffer: 30 },
  { id: "starling-new", bank: "Starling", name: "New account", kind: "Current", balance: 310, available: 180, payments: 90, plans: 20, low: 200, buffer: 20 },
];

export const bankLogo: Partial<Record<Bank, string>> = {
  Barclays: "/banks/barclays.png", HSBC: "/banks/hsbc.png", NatWest: "/banks/natwest.png", Monzo: "/banks/monzo.png", Starling: "/banks/starling.png", Amex: "/banks/amex.png",
};

export const kinds: Kind[] = ["Current", "Savings", "Pot", "Credit", "Offline"];
