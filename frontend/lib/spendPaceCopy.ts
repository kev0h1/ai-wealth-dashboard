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
  residualLabel: string | null;
  residualCaption: string | null;
  total: number | null;
  totalLabel: string | null;
};

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function formatWholePounds(value: number): string {
  const rounded = Math.round(Math.abs(value));
  return `${value < 0 && rounded > 0 ? "−" : ""}£${rounded.toLocaleString("en-GB")}`;
}

export function formatSignedMoney(value: number, { plus = false }: { plus?: boolean } = {}): string {
  // Match the hero's display precision. Rounding first also turns sub-penny
  // values into a true zero, so a negative sign can never precede £0.
  const pennies = Math.round(Math.abs(value) * 100);
  const prefix = value < 0 && pennies > 0 ? "−" : plus && pennies > 0 ? "+" : "";
  return `${prefix}£${(pennies / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
      residualLabel: null,
      residualCaption: null,
      total: null,
      totalLabel: null,
    };
  }

  const total = input.actualOut - input.usualByNow;
  const named = input.namedCategories.length > 0;
  const residual = named ? total - input.namedExcess : null;
  const unresolved = input.unresolvedTotal > 0 ? " It may include payments not yet sorted." : "";
  const residualPence = residual === null ? 0 : Math.round(residual * 100);
  const totalPence = Math.round(total * 100);

  return {
    verdict: total > 0 ? "above" : total < 0 ? "below" : "level",
    baselineLine: `By day ${input.daysElapsed} you usually spend about ${formatWholePounds(input.usualByNow)}. We work this out from your last 3 months.`,
    namedLabel: named ? `More than usual on ${joinNames(input.namedCategories)}` : null,
    namedExcess: named ? input.namedExcess : null,
    residual,
    residualLabel: residual === null
      ? null
      : residualPence < 0
        ? "Less than usual on everything else"
        : residualPence > 0
          ? "More than usual on everything else"
          : "Same as usual on everything else",
    residualCaption: residual === null ? null : `This is what's left after the categories above.${unresolved}`,
    totalLabel: totalPence > 0 ? "More than usual in total" : totalPence < 0 ? "Less than usual in total" : "Same as usual in total",
    total,
  };
}
