// Per-transaction currency display + home-currency filtering.
//
// Totals (spend/income/net, budgets, charts) are single-currency: they only
// sum transactions in the user's home currency. Foreign-currency transactions
// (e.g. a holiday spend abroad on a UK card) still appear in lists with
// their own symbol, but are never silently added to home-currency totals.
// The non-GBP symbols below are for exactly that case: a transaction's own
// currency, never a region setting (A98 removed the only region there was).

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "£",
  KES: "KSh ",
  USD: "$",
  EUR: "€",
};

export function currencySymbol(code?: string): string {
  if (!code) return "£";
  return CURRENCY_SYMBOLS[code] ?? `${code} `;
}

export function formatCurrency(amount: number, currency?: string): string {
  const abs = Math.abs(amount).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currencySymbol(currency)}${abs}`;
}

/** The only home currency the app supports (A98 removed the Kenya region). */
export function homeCurrency(): string {
  return "GBP";
}

export function isHomeCurrency(txCurrency: string | undefined): boolean {
  return !txCurrency || txCurrency === homeCurrency();
}
