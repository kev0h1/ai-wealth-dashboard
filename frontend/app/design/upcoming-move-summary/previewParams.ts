export const EXAMPLES = [
  { value: "moves", label: "Suggested moves" },
  { value: "partial", label: "Partly covered" },
  { value: "uncovered", label: "No suggested cover" },
  { value: "long", label: "Long account names" },
  { value: "no-date", label: "No deadline supplied" },
  { value: "mixed-dates", label: "Different source deadlines" },
  { value: "pennies", label: "Amounts with pence" },
  { value: "estimated", label: "Estimated paying account" },
  { value: "uncertain", label: "Plans need checking" },
  { value: "unknown", label: "Balance unavailable" },
  { value: "pending", label: "Checking plans" },
  { value: "error", label: "Plans unavailable" },
  { value: "fine", label: "All accounts fine" },
  { value: "empty", label: "No accounts" },
] as const;

export type Example = typeof EXAMPLES[number]["value"];
export type PreviewParams = { variant: "a1" | "a2" | "a" | "b" | "current"; mode: "light" | "dark"; state: Example; hidden: boolean };
export function parsePreviewParams(query: Record<string, string | string[] | undefined>): PreviewParams {
  return {
    variant: query.variant === "a" || query.variant === "b" || query.variant === "current" || query.variant === "a2" ? query.variant : "a1",
    mode: query.mode === "dark" ? "dark" : "light",
    state: EXAMPLES.some(item => item.value === query.state) ? query.state as Example : "moves",
    hidden: query.hidden === "1",
  };
}
export function previewHref(params: PreviewParams) {
  return `/design/upcoming-move-summary?${new URLSearchParams({ variant: params.variant, state: params.state, mode: params.mode, hidden: params.hidden ? "1" : "0" })}`;
}
