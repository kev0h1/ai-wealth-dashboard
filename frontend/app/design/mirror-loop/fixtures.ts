export type Scenario = "active" | "choose" | "kept" | "below" | "near" | "past" | "thin" | "stale" | "error" | "long";
export const scenarios: Scenario[] = ["active", "choose", "kept", "below", "near", "past", "thin", "stale", "error", "long"];
export type Example = { spent: number; aim: number; closed: boolean; period: string };
export function exampleFor(scenario: Scenario): Example {
  return {
    spent: scenario === "long" ? 123358.75 : scenario === "below" ? 322 : scenario === "near" ? 338 : 358,
    aim: scenario === "long" ? 123340 : 340,
    closed: scenario === "below" || scenario === "near" || scenario === "past",
    period: ["below", "near", "past"].includes(scenario) ? "5 Sep–2 Oct" : "3–30 Oct",
  };
}
export function evidenceFor(scenario: Scenario) {
  const example = exampleFor(scenario);
  const dates = example.closed ? ["06 Sep", "11 Sep", "20 Sep", "28 Sep", "02 Oct"] : ["03 Oct", "08 Oct", "13 Oct", "17 Oct", "17 Oct"];
  const values = [42.5, 31.2, 56.8, 27.4, Math.round((example.spent - 157.9) * 100) / 100];
  const names = ["The Lantern", "Nori House", "Corner Table", "Market Kitchen", "Other illustrative payments"];
  return names.map((name, i) => ({ date: dates[i], name, amount: values[i] }));
}
export const frequency = [
  { week: "13–19 Sep", count: 6 }, { week: "20–26 Sep", count: 5 },
  { week: "27 Sep–3 Oct", count: 5 }, { week: "4–10 Oct", count: 4 },
];
export const fees = [
  { date: "06 Sep", name: "Overdraft fee", amount: 10 },
  { date: "13 Sep", name: "Card payment fee", amount: 6 },
  { date: "20 Sep", name: "Account service charge", amount: 12 },
  { date: "27 Sep", name: "Direct Debit charge", amount: 8 },
];
