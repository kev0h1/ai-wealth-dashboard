export type PaceVerdict = "above" | "below" | "level" | "unavailable";

export type PaceCopyInput = {
  daysElapsed: number;
  actualOut: number;
  usualByNow: number | null;
  namedCategories: string[];
  namedExcess: number;
  unresolvedTotal: number;
};

export type PaceCopy = {
  verdict: PaceVerdict;
  baselineLine: string | null;
  namedLabel: string | null;
  namedExcess: number | null;
  residual: number | null;
  residualCaption: string | null;
  total: number | null;
};

export function formatSignedMoney(value: number, { plus = false }: { plus?: boolean } = {}): string {
  // Match the hero's display precision. Rounding first also turns sub-penny
  // values into a true zero, so a negative sign can never precede £0.
  const pennies = Math.round(Math.abs(value) * 100);
  const prefix = value < 0 && pennies > 0 ? "−" : plus && pennies > 0 ? "+" : "";
  return `${prefix}£${(pennies / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
}

/**
 * Formats the server-provided pace comparison without changing its
 * calculation. `usualByNow` is the latest non-null point in pace_series.
 */
export function derivePaceCopy(input: PaceCopyInput): PaceCopy {
  if (input.usualByNow === null) {
    return {
      verdict: "unavailable",
      baselineLine: null,
      namedLabel: null,
      namedExcess: null,
      residual: null,
      residualCaption: null,
      total: null,
    };
  }

  const total = input.actualOut - input.usualByNow;
  const named = input.namedCategories.length > 0;
  const residual = named ? total - input.namedExcess : null;
  const unresolved = input.unresolvedTotal > 0 ? " It may include payments still to categorise." : "";

  return {
    verdict: total > 0 ? "above" : total < 0 ? "below" : "level",
    baselineLine: `Your usual pace by day ${input.daysElapsed} is ${formatSignedMoney(input.usualByNow)}. Usual pace is based on the median of up to three 30-day spending totals for each category before this pay period, adjusted for how far through the period you are.`,
    namedLabel: named ? `Above usual: ${input.namedCategories.join(", ")}` : null,
    namedExcess: named ? input.namedExcess : null,
    residual,
    residualCaption: residual === null
      ? null
      : `Balancing amount, calculated as total difference minus the named category excess.${unresolved}`,
    total,
  };
}
