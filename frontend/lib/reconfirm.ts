// A182: the 90-day bank reconfirmation prompt. Pure helpers so the wording and
// the show/hide rule are testable without a DOM.
//
// Copy is Kevin's, kept exactly: the question and the button. Every consent
// screen needs Finexer's written approval (A6.2/A6.2A), so changes to these
// strings go back through that route.

import type { Connection } from "@wealth/shared";

export const RECONFIRM_BUTTON = "Yes, carry on";
export const RECONFIRM_ERROR = "We could not confirm just now. Try again later.";
export const RECONFIRM_DISMISS_LABEL = "Not now";

export function reconfirmQuestion(bank: string | null | undefined): string {
  const name = bank && bank.trim() ? bank.trim() : "bank";
  return `Still OK for Sorted to read your ${name} data?`;
}

export function reconfirmDismissKey(connectionId: string): string {
  return `wd_reconfirm_dismissed:${connectionId}`;
}

/** Dismissed until the due day: the stored value is the due date it was
 *  dismissed against, and it hides the prompt until that day arrives. A new
 *  due date (after a reconfirmation) is a new prompt. */
export function isReconfirmDismissed(
  stored: string | null | undefined,
  nextReconfirmBy: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!stored || !nextReconfirmBy || stored !== nextReconfirmBy) return false;
  const due = new Date(nextReconfirmBy);
  if (Number.isNaN(due.getTime())) return false;
  return now.getTime() < due.getTime();
}

/** The consent to ask about, or null. First one inside its prompt window. */
export function pickReconfirmConnection(
  connections: Connection[],
  readDismissed: (key: string) => string | null,
  now: Date = new Date(),
): Connection | null {
  for (const c of connections) {
    if (c.provider !== "finexer" || c.status !== "authorized" || !c.reconfirm_prompt) continue;
    if (isReconfirmDismissed(readDismissed(reconfirmDismissKey(c.connection_id)), c.next_reconfirm_by, now)) continue;
    return c;
  }
  return null;
}

/** "Next reconfirmation 30 January 2027", or null when none is due. */
export function formatNextReconfirm(nextReconfirmBy: string | null | undefined): string | null {
  if (!nextReconfirmBy) return null;
  const d = new Date(nextReconfirmBy);
  if (Number.isNaN(d.getTime())) return null;
  return `Next reconfirmation ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;
}

/** Plain lines for the connection row on the account detail (A182). Empty
 *  when the connection carries nothing to say. */
export function connectionNotes(connection: Connection | undefined): string[] {
  if (!connection) return [];
  const notes: string[] = [];
  const next = connection.status === "authorized" ? formatNextReconfirm(connection.next_reconfirm_by) : null;
  if (next) notes.push(next);
  return notes;
}
