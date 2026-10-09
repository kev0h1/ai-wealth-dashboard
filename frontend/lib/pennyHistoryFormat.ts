// G248: date helpers for the Penny history list. Europe/London, like every
// other user-facing day in the app.

const ZONE = "Europe/London";

function londonYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** "9 Oct", or "9 Oct 2025" when the year differs from `now`'s. */
export function formatHistoryDate(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = londonYmd(d).slice(0, 4) === londonYmd(now).slice(0, 4);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE, day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }),
  }).format(d).replace("Sept", "Sep"); // newer ICU spells September "Sept"; UK style is "Sep"
}

export const HISTORY_RETENTION_NOTE = "Only your last 10 chats are kept, for 7 days after the last message.";
export const HISTORY_EMPTY = "No earlier chats yet.";
export const OPEN_LAST_CHAT_LABEL = "Open my last chat";
export const OPEN_LAST_CHAT_HELPER = "When on, resume your last chat after restarting or refreshing.";
