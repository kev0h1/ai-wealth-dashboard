// A113: pure formatter behind the Terms/Privacy v1.1 promise "the Service
// shows when your current consent ends" (Terms) / "We show when your
// current consent ends and prompt you before then" (Privacy). A109 was
// rejected because that sentence wasn't true yet — no frontend file read
// `consent_expires_at`/`expires_at` and nothing rendered an end date. This
// is the deterministic half: given a connection's `expires_at`, decide
// whether there is anything honest to say.
//
// Deliberately degrades to `null` (render nothing) rather than guessing:
//   - missing/absent expiry (manual accounts, statement uploads, some live
//     connections that never recorded one) — there is no consent to speak
//     of, or the date genuinely isn't known, so implying one would be
//     dishonest.
//   - an unparseable string — never render "Invalid Date".
//   - an expiry that has already passed — this isn't the connection's
//     CURRENT consent any more, so the promise ("when your current consent
//     ends") no longer applies; the existing ReconnectStrip/reconnect
//     banner (AccountsPage.tsx) already owns telling the user that story,
//     and this must not duplicate or contradict it with a second signifier.
//
// No colour, no urgency framing: an approaching expiry is routine
// housekeeping (DESIGN.md's Red Is Risk Rule — this is not a risk), so the
// caller renders this as a plain slate-ink line, not a badge.

export function formatConsentExpiry(
  expiresAt: string | null | undefined,
  now: Date = new Date()
): string | null {
  if (!expiresAt) return null;
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() <= now.getTime()) return null;
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `Connected until ${date}`;
}
