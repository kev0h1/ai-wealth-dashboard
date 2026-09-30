import type { UpcomingRowModel } from "../components/upcoming/UpcomingRow";

export type UpcomingStatus = {
  kind: "issue" | "covered" | "income" | "future" | "card" | "settling";
  label: string;
  tone: "risk" | "caution" | "neutral";
  shortfall?: number;
};

export function upcomingMoney(amount: number, decimals = false) {
  return `${amount < 0 ? "−" : ""}£${Math.abs(amount).toLocaleString("en-GB", {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

// Presentation only. Coverage comes from the existing account walk, never
// from a second forecast or from the absence of a red flag.
export function getUpcomingStatus(model: UpcomingRowModel): UpcomingStatus {
  if (model.isSettling) return { kind: "settling", label: "Settling", tone: "neutral" };
  if (model.type === "income") {
    return model.pending
      ? { kind: "issue", label: "Not arrived yet", tone: "caution" }
      : { kind: "income", label: "Expected income", tone: "neutral" };
  }

  const isMove = Boolean(model.isMovement || model.coverage?.optionalMove);
  const shortfall = model.coverage?.shortfall;
  const verified = model.assessment !== "unverified" && shortfall !== undefined && Number.isFinite(shortfall);
  const assessed = model.assessment !== "future" && !model.isCreditCard;
  if (assessed && isMove && (verified ? shortfall! > 0 : model.movementCalm || model.unfundedMovement)) {
    return { kind: "issue", label: "unfunded", tone: "caution", shortfall: shortfall && shortfall > 0 ? shortfall : undefined };
  }
  if (assessed && !isMove && (verified ? shortfall! > 0 : model.flagged || model.accountShort || model.atRisk)) {
    return {
      kind: "issue", tone: "risk",
      label: shortfall && shortfall > 0 ? "short" : model.flagged || model.accountShort ? "Account short" : "Cash short",
      shortfall: shortfall && shortfall > 0 ? shortfall : undefined,
    };
  }
  if (assessed && (model.timingRisk || model.accountTiming)) {
    return { kind: "issue", label: "Money due in", tone: "caution" };
  }
  // A forecast of sufficient cash does not mean an overdue payment has left.
  if (model.pending || (model.daysPastDue ?? 0) > 0) {
    return { kind: "issue", label: "Not left yet", tone: !isMove && model.category === "Debt" && (model.daysPastDue ?? 0) >= 5 ? "risk" : "caution" };
  }
  if (model.assessment === "future") return { kind: "future", label: "Next period", tone: "neutral" };
  if (model.isCreditCard) return { kind: "card", label: "On your card", tone: "neutral" };
  if (model.assessment !== "unverified" && shortfall !== undefined && Number.isFinite(shortfall) && shortfall <= 0) {
    return { kind: "covered", label: "Covered", tone: "neutral" };
  }
  return { kind: "issue", label: "Coverage unavailable", tone: "neutral" };
}

export function upcomingStatusText(status: UpcomingStatus) {
  return status.shortfall === undefined ? status.label : `${upcomingMoney(status.shortfall)} ${status.label}`;
}

export function canDismissUpcomingOccurrence(model: UpcomingRowModel) {
  return model.type === "bill" && !model.isSettling && Boolean(model.pending) && (
    (model.isMovement && (model.unfundedMovement || (model.coverage?.shortfall ?? 0) > 0)) ||
    (model.daysPastDue ?? 0) >= 5
  );
}

export function upcomingPaymentKey(item: { account_id?: string | null; expected_date: string; amount: number; name?: string }) {
  return `${item.account_id ?? "__null__"}|${item.expected_date}|${item.amount}|${item.name ?? ""}`;
}
