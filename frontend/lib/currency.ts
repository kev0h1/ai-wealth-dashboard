// Per-transaction currency display + home-currency filtering.
//
// Totals (spend/income/net, budgets, charts) are single-currency: they only
// sum transactions in the user's home currency. Foreign-currency transactions
// (e.g. a KES M-Pesa statement on a UK account) still appear in lists with
// their own symbol, but are never silently added to home-currency totals.

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

export function homeCurrency(region?: string): string {
  return region === "Kenya" ? "KES" : "GBP";
}

export function isHomeCurrency(txCurrency: string | undefined, region?: string): boolean {
  return !txCurrency || txCurrency === homeCurrency(region);
}
