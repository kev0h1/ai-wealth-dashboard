// Ordinal-suffix date helpers. Kept separate from lib/comingUp.tsx (rather
// than folded into it) so any other surface that wants "19th" instead of a
// bare "19" can import it without pulling in Coming Up's bill types — see
// G170.

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 4 -> "4th", 11/12/13 -> "th"
 *  regardless of the last digit (the classic English exception), then by
 *  last digit: 1 -> st, 2 -> nd, 3 -> rd, else th. Covers 1-31 (the only
 *  range a calendar day-of-month ever needs) but works for any integer. */
export function ordinalDay(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

// Matches the "Wed 19 Aug" shape our own backend strftime already produces
// (short weekday, day-of-month with no leading zero, short month, no year —
// see formatShortDate in lib/comingUp.tsx). Deterministic input, so this is
// a tight match rather than a lenient one: if that upstream format ever
// changes, shortDateWithOrdinal below falls back to the original string
// instead of silently mangling it.
const SHORT_DATE_RE = /^([A-Za-z]{3}) (\d{1,2}) ([A-Za-z]{3})$/;

/** "Wed 19 Aug" -> "Wed 19th Aug". Takes the already-formatted short-date
 *  string (not a Date) deliberately: the weekday and month in that string
 *  were derived from the real ISO date upstream, so re-deriving them here
 *  from a re-parsed Date would risk drifting from the source (e.g. a
 *  year-boundary bill where day/month alone can't fix the year). Falls
 *  back to the original string unchanged when it doesn't match the
 *  expected shape, so an unexpected upstream format degrades to the old
 *  copy rather than showing broken text. */
export function shortDateWithOrdinal(shortDate: string): string {
  const match = SHORT_DATE_RE.exec(shortDate);
  if (!match) return shortDate;
  const [, weekday, dayStr, month] = match;
  const day = Number(dayStr);
  if (!Number.isFinite(day) || day < 1 || day > 31) return shortDate;
  return `${weekday} ${ordinalDay(day)} ${month}`;
}
