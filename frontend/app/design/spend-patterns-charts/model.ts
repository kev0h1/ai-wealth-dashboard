// G380 synthetic examples. No bank data, classification writes or production rules.
export type Example = "large" | "ordinary" | "multiple" | "not-counted" | "sparse" | "empty" | "loading" | "error";
export type Payment = { id: string; day: number; name: string; amount: number; counted: boolean };
export const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
export const gbp = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);

export function exampleData(example: Example) {
  const payments: Payment[] = example === "empty" ? [] : Array.from({ length: example === "sparse" ? 4 : 30 }, (_, i) => [
    { id: `a-${i}`, day: i + 1, name: "Everyday payment", amount: 12 + (i * 7) % 44, counted: true },
    { id: `b-${i}`, day: i + 1, name: "Everyday payment", amount: 28 + (i * 13) % 96, counted: true },
  ]).flat();
  if (["large", "multiple", "not-counted"].includes(example)) payments.push({ id: "large-1", day: 12, name: "Business payment", amount: 15271, counted: example !== "not-counted" });
  if (example === "multiple") payments.push({ id: "large-2", day: 23, name: "Household payment", amount: 4800, counted: true });
  const counted = payments.filter(p => p.counted);
  const amounts = counted.map(p => p.amount).sort((a, b) => a - b);
  const median = amounts.length ? (amounts[Math.floor((amounts.length - 1) / 2)] + amounts[Math.floor(amounts.length / 2)]) / 2 : 0;
  // Display separation only. This never marks a transaction as Not counted.
  const threshold = Math.max(1000, median * 10);
  const larger = counted.filter(p => p.amount > threshold);
  const largerIds = new Set(larger.map(p => p.id));
  const rest = counted.filter(p => !largerIds.has(p.id));
  const total = sum(counted.map(p => p.amount));
  const largeTotal = sum(larger.map(p => p.amount));
  const history = example === "sparse" || example === "empty" ? [] : [3400, 3800, 3600];
  const usual = history.length ? sum(history) / history.length : null;
  return { payments, counted, larger, rest, threshold, total, largeTotal, restTotal: total - largeTotal, usual,
    excluded: payments.filter(p => !p.counted),
    periods: [
      { label: "3 Jun–2 Jul", value: null },
      { label: "3 Jul–1 Aug", value: history[0] ?? null },
      { label: "2–31 Aug", value: history[1] ?? null },
      { label: "1–30 Sep", value: history[2] ?? null },
      { label: "1–30 Oct", value: example === "sparse" ? null : total },
    ],
  };
}
export function dailyValues(payments: Payment[]) {
  return Array.from({ length: 30 }, (_, i) => sum(payments.filter(p => p.day === i + 1).map(p => p.amount)));
}
export function sizeBands(payments: Payment[]) {
  return [{ label: "Under £25", min: 0, max: 25 }, { label: "£25–£99", min: 25, max: 100 }, { label: "£100–£249", min: 100, max: 250 }, { label: "£250 or more", min: 250, max: Infinity }].map(band => {
    const group = payments.filter(p => p.amount >= band.min && p.amount < band.max);
    return { label: band.label, count: group.length, total: sum(group.map(p => p.amount)) };
  });
}
