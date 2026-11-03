// Invented examples, not customer accounts or live forecasting results.
import type { Account } from "@/lib/api";
import type { Example } from "./model";

const bank = (id: string, provider: string, name: string, balance: number): Account => ({ id, name, provider, provider_id: provider.toLowerCase(), type: "bank", subtype: "CURRENT", currency: "GBP", status: "connected", balance });
const barclays = bank("g408-barclays", "Barclays", "Everyday account", 2000.37);
const monzo = bank("g408-monzo", "Monzo", "Bills account", 1000);
const base: Example = {
  id: "unconfirmed", label: "Unconfirmed repayment", headline: 1592.37, projected: 1592.37,
  status: { tone: "watch", label: "Tight" }, headlineLabel: "Estimated left to spend",
  support: "Estimated cash left until Fri 27 Nov, after upcoming bills and plans.",
  rows: [{ label: "Cash now", value: 3000.37 }, { label: "Bills before payday", value: -1300 }, { label: "Card amount held back", value: -108 }, { label: "Left to spend", value: 1592.37, total: true }],
  daily: 63.69, payday: "2026-11-27", days: 25, expectedPay: 5207,
  // £183 purchases less £75 repaid is £108 net growth. Reserve follows
  // unconfirmed balance growth, not the purchases-only header.
  card: { purchases: 183, balanceGrowth: 108, hold: 108, repayment: "unconfirmed", debt: 1800 },
  sources: [{ account: barclays, limit: 920 }, { account: monzo, limit: 780 }], showCardsLink: true,
};

const confirmed: Example = {
  ...base, id: "confirmed", label: "Confirmed repayment", headline: 439.12, projected: 439.12,
  rows: [{ label: "Cash now", value: 1700 }, { label: "Bills before payday", value: -1260.88 }, { label: "Left to spend", value: 439.12, total: true }],
  ledgerNote: "The confirmed card repayment is included in bills. Card purchases are not deducted again.",
  daily: 17.56, card: { ...base.card, hold: 0, repayment: "confirmed" }, sources: [{ account: { ...barclays, balance: 1700 }, limit: 439.12 }],
};

export const EXAMPLES: Record<string, Example> = {
  unconfirmed: base,
  confirmed,
  reference: {
    ...base, id: "reference", label: "Layout reference", headline: 1792, projected: 1792,
    status: { tone: "good", label: "Looks on track" },
    support: "£310 held while a card bill is unconfirmed, after upcoming bills.",
    // Screenshot-shaped totals. Reserve and aggregate balance growth are
    // distinct supplied fields, not an equation reconstructed from purchases.
    rows: [{ label: "Cash now", value: 3402 }, { label: "Bills before payday", value: -1300 }, { label: "Card amount held back", value: -310 }, { label: "Left to spend", value: 1792, total: true }],
    daily: 71.68, card: { ...base.card, hold: 310 }, showCardsLink: false,
    sources: [{ account: { ...barclays, balance: 2200 }, limit: 1388 }, { account: bank("g408-chase", "Chase", "Everyday account", 1202), limit: 300 }],
  },
  transfer: {
    ...base, id: "transfer", label: "Balance includes a transfer", headline: 1240.37, projected: 1240.37,
    rows: [{ label: "Cash now", value: 3000.37 }, { label: "Bills before payday", value: -1300 }, { label: "Card amount held back", value: -460 }, { label: "Left to spend", value: 1240.37, total: true }],
    daily: 49.61, card: { ...base.card, balanceGrowth: 460, hold: 460 },
  },
  "card-gap": {
    ...base, id: "card-gap", label: "Card amount exceeds cash", headline: 0, projected: -48,
    status: { tone: "watch", label: "Check card bill" },
    support: "Bills fit, but the unconfirmed card amount uses the remaining cash.",
    rows: [{ label: "Cash now", value: 560 }, { label: "Bills before payday", value: -500 }, { label: "Card amount held back", value: -108 }, { label: "After card hold", value: -48, total: true }],
    ledgerNote: "There is a £48 gap after the card hold. The available amount above stays at £0 while the card repayment needs checking.",
    daily: null, sources: [], showCardsLink: false, recovery: { label: "Review card bill", destination: "/cards" },
  },
  "earlier-gap": {
    ...base, id: "earlier-gap", label: "Earlier cash low point", headline: -400, projected: -400, lowPoint: -400,
    status: { tone: "risk", label: "Short" }, headlineLabel: "Shortfall before payday",
    support: "The cash forecast dips below zero before payday. An ending balance can hide an earlier gap.",
    // Home exposes the minimum, not its dated event breakdown. Do not
    // invent a prefix equation or rebuild the backend walk in the client.
    rows: [{ label: "Left to spend at the cash low point", value: -400, total: true }],
    ledgerNote: "This uses the lowest cash forecast, rather than the ending balance. Income elsewhere in the period does not necessarily cover an earlier cash gap.",
    incomeBeforePayday: 1300, daily: null,
    card: { ...base.card, hold: 0, repayment: "confirmed" }, sources: [], showCardsLink: false,
    recovery: { label: "See what’s due", destination: "/upcoming" },
  },
  reserves: {
    ...base, id: "reserves", label: "Buffer and plans", headline: 492, projected: 492,
    rows: [{ label: "Cash now", value: 2000 }, { label: "Bills before payday", value: -800 }, { label: "Buffer", value: -200 }, { label: "Goal contributions", value: -250 }, { label: "Set-asides", value: -150 }, { label: "Card amount held back", value: -108 }, { label: "Left to spend", value: 492, total: true }],
    daily: 19.68, sources: [{ account: { ...barclays, balance: 1500 }, limit: 310 }, { account: { ...monzo, balance: 500 }, limit: 220 }],
  },
  "no-activity": {
    ...confirmed, id: "no-activity", label: "No new card spending",
    card: { purchases: 0, balanceGrowth: 0, hold: 0, repayment: "confirmed", debt: 1800 },
  },
  syncing: {
    ...base, id: "syncing", label: "Updating bank data", syncing: true,
    status: { tone: "neutral", label: "Updating" }, showCardsLink: false,
  },
  unavailable: {
    ...base, id: "unavailable", label: "Forecast unavailable", headline: null, projected: null,
    status: { tone: "neutral", label: "Check forecast" }, support: "A complete forecast is not available yet.",
    rows: [], daily: null, expectedPay: null,
    card: { purchases: null, balanceGrowth: null, hold: null, repayment: "unknown", debt: 0 },
    sources: [], showCardsLink: false, recovery: { label: "Try again", destination: "/refresh" },
  },
};
// Keep the real route's G397 conditions: a tight state, enough known card
// debt and no sync. A card-only gap retains its own hero recovery instead.
export const EXAMPLE_IDS = Object.keys(EXAMPLES);
