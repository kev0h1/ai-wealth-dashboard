export type PaceVerdict = "above" | "below" | "level" | "unavailable";

export type PaceCopyInput = {
  daysElapsed: number;
  /** Existing Spend UI arithmetic: Out less usual-by-now. */
  actualOut: number;
  usualByNow: number | null;
  namedCategories: string[];
  /** Sum of the visible notable categories' positive excesses. */
  namedExcess: number;
  unresolvedTotal: number;
};

export type PaceCopy = {
  verdict: PaceVerdict;
  headline: string;
  baselineLine: string;
  namedLabel: string | null;
  namedExcess: number | null;
  residual: number | null;
  residualCaption: string | null;
  totalLabel: string | null;
  total: number | null;
};

export function formatMoney(value: number, { plus = false }: { plus?: boolean } = {}): string {
  const rounded = Math.round(value);
  const prefix = rounded < 0 ? "−" : plus && rounded > 0 ? "+" : "";
  return `${prefix}£${Math.abs(rounded).toLocaleString("en-GB")}`;
}

function verdictFor(delta: number | null): PaceVerdict {
  if (delta === null) return "unavailable";
  if (delta > 0) return "above";
  if (delta < 0) return "below";
  return "level";
}

export function derivePaceCopy(input: PaceCopyInput): PaceCopy {
  const verdict = verdictFor(input.usualByNow === null ? null : input.actualOut - input.usualByNow);
  if (input.usualByNow === null) {
    return {
      verdict,
      headline: "We are still learning your usual pace",
      baselineLine: "A comparison appears once we have enough spending history.",
      namedLabel: null,
      namedExcess: null,
      residual: null,
      residualCaption: null,
      totalLabel: null,
      total: null,
    };
  }

  const total = input.actualOut - input.usualByNow;
  const namedLabel = input.namedCategories.length
    ? `Above usual: ${input.namedCategories.join(", ")}`
    : null;
  const residual = input.namedCategories.length ? total - input.namedExcess : null;
  const unresolved = input.unresolvedTotal > 0
    ? " It may include payments still to categorise."
    : "";

  return {
    verdict,
    headline: verdict === "above"
      ? `${formatMoney(total)} above your usual pace so far`
      : verdict === "below"
        ? `${formatMoney(Math.abs(total))} below your usual pace so far`
        : "In line with your usual pace so far",
    baselineLine: `Your usual pace by day ${input.daysElapsed} is ${formatMoney(input.usualByNow)}. Usual pace is based on the median of up to three 30-day spending totals for each category before this pay period, adjusted for how far through the period you are.`,
    namedLabel,
    namedExcess: input.namedCategories.length ? input.namedExcess : null,
    residual,
    residualCaption: residual === null
      ? null
      : `Balancing amount, calculated as total difference minus the named category excess.${unresolved}`,
    totalLabel: "Difference from usual pace",
    total,
  };
}
