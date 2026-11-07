import { accountActionNote, type accountActionReading } from "@/lib/upcomingAccountPresentation";
import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";

type Reading = ReturnType<typeof accountActionReading>;
const money = (pence: number) => `${pence < 0 ? "−" : ""}£${(Math.abs(pence) / 100).toLocaleString("en-GB", { minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

function day(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

/** One aggregate date is honest only when every incoming leg proves the same deadline. */
export function summaryDeadline(reading: Reading): string | null {
  const dates = reading.moves.filter(move => move.amount > 0).map(move => day(move.byDate));
  return dates.length > 0 && dates.every(date => date !== null && date === dates[0]) ? dates[0] : null;
}
const deadlineText = (value: string | null) => value ? ` by ${new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : "";

/** Preview presentation only. All amounts are the existing reading's integer pence. */
export function accountMoveSummary(account: UpcomingAccountSummary, reading: Reading): string | null {
  if (reading.headline === null || !reading.ready) return accountActionNote(account, reading);
  if (!reading.combinedKnown) return "Payments only. Plans need checking.";
  const estimated = reading.result.estimated ? "Paying account based on recent transfers." : "";
  if (reading.gap <= 0) return estimated || null;
  const uncovered = reading.remainingGap > 0 ? `${money(reading.remainingGap)} still uncovered` : "";
  const summary = reading.incoming > 0
    ? `${money(reading.incoming)} to move in${deadlineText(summaryDeadline(reading))}${uncovered ? ` · ${uncovered}` : ""}`
    : `${uncovered}${reading.outgoing > 0 ? " after suggested moves" : ""}`;
  return estimated ? `${summary}. ${estimated}` : summary;
}
