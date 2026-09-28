/**
 * D7: one rule for turning what we know about a user into something safe to
 * greet or display them by, instead of the three ad hoc versions of it that
 * Home, Settings and Penny would otherwise each grow on their own.
 *
 * The bug this exists to close: Home greeted a new user "Good evening,
 * jjdk4..." after they had already entered their name in onboarding.
 * routers/auth.py's session name comes straight from the sign-in
 * provider's name claim, and that claim is not reliable:
 *   - Apple only hands over a real name on the very first authorization
 *     ever performed with this app (see apple_native()'s docstring) — every
 *     sign-in after that used to fall back to the email's local part, and a
 *     Hide My Email relay address (e.g. "jjdk4@privaterelay.appleid.com")
 *     turned that fallback into a meaningless string. D7 also fixed
 *     apple_native() itself to leave the session name empty in that case
 *     rather than manufacture one from the email — the checks below are
 *     defence in depth for any session token issued before that fix, or by
 *     a path that still hands over an email-shaped name.
 *   - A Google account with no display name set hands over an empty name
 *     claim (Google's own paths never fell back to the email here).
 * Onboarding writes the user's real name into their profile
 * (`full_name`, via PUT /profile) regardless of what the session carries,
 * so the profile is the value to prefer; the session name is only a
 * fallback for the (now rare) case a profile name has not been saved yet.
 */

interface NameSources {
  /** profile.full_name — what the user actually typed in onboarding or
   * Settings. Trusted as-is (just trimmed): a user is free to type a name
   * that happens to contain digits or an unusual shape, so none of the
   * session-name rejection rules below apply to this field. */
  fullName?: string | null;
  /** The sign-in provider's name claim, as carried on the session token.
   * Not trusted at face value — see the module doc above. */
  sessionName?: string | null;
  /** The user's email, used only to recognise a session name that is (or
   * matches) its own local part. Never itself returned as a name. */
  email?: string | null;
}

/** Apple's Hide My Email relay local parts — and email local parts more
 * generally — are opaque alphanumeric tokens (e.g. "jjdk4"); real first or
 * full names don't contain digits. This is independent of the exact
 * local-part match below, since the `email` a caller passes in is not
 * guaranteed to be byte-for-byte the address a stale session token's name
 * was originally derived from. */
function looksLikeEmailShapedPlaceholder(value: string): boolean {
  return /\d/.test(value);
}

/** True when `sessionName` is safe to show as a name: not empty, not a
 * bare email address, not the email's own local part, and not shaped like
 * a relay/local-part placeholder. */
function isUsableSessionName(sessionName: string | null | undefined, email?: string | null): sessionName is string {
  const trimmed = (sessionName ?? "").trim();
  if (!trimmed) return false;
  if (trimmed.includes("@")) return false; // a full email address, not a name
  if (looksLikeEmailShapedPlaceholder(trimmed)) return false;
  const localPart = (email ?? "").split("@")[0]?.trim().toLowerCase();
  if (localPart && trimmed.toLowerCase() === localPart) return false; // provider's email-local-part fallback
  return true;
}

/**
 * Resolves the best full name available: profile.full_name first (trusted
 * as typed), else the session name unless it looks email-derived, never an
 * email or its local part either way. Returns null when neither source
 * holds a usable name.
 *
 * This is the shared resolution the rest of this module (and every caller
 * that needs more than just a first name, e.g. avatar initials) builds on;
 * `resolveDisplayName` below is this plus taking the first word.
 */
export function resolveFullName({ fullName, sessionName, email }: NameSources): string | null {
  const trimmedFull = (fullName ?? "").trim();
  if (trimmedFull) return trimmedFull;
  if (isUsableSessionName(sessionName, email)) return sessionName.trim();
  return null;
}

/**
 * Resolves the first name to greet a user with: prefers profile.full_name's
 * first word, else falls back to the session name unless it equals the
 * email local part, looks like an Apple relay/email-shaped placeholder, or
 * contains "@" — and never returns anything derived from the email itself.
 * Returns null when nothing usable exists, so callers fall back to a
 * name-free greeting (e.g. "Good evening").
 */
export function resolveDisplayName(sources: NameSources): string | null {
  return firstNameOf(resolveFullName(sources)) ?? null;
}

/** First word of a resolved name, e.g. for "Hi, {firstName}" greetings. */
export function firstNameOf(name: string | null | undefined): string | undefined {
  return name?.trim().split(/\s+/)[0] || undefined;
}

/** Up to two initials (first two words) of a resolved name, for an avatar
 * badge. Returns undefined when there is no real name to initial. */
export function initialsOf(name: string | null | undefined): string | undefined {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return undefined;
  const words = trimmed.split(/\s+/).filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return initials || undefined;
}
