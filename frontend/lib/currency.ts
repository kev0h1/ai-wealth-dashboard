export function formatCurrency(amount: number, currency: string): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const symbol = currency === "KES" ? "KES " : "£";
  return `${symbol}${formatted}`;
}

export function currencySymbol(currency: string): string {
  return currency === "KES" ? "KES" : "£";
}
