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
 *     sign-in after that falls back to the email's local part, and a
 *     Hide My Email relay address (e.g. "jjdk4@privaterelay.appleid.com")
 *     turns that fallback into a meaningless string.
 *   - A Google account with no display name set hands over an empty name
 *     claim.
 * Onboarding writes the user's real name into their profile
 * (`full_name`, via PUT /profile) regardless of what the session carries,
 * so the profile is the value to prefer; the session name is only a
 * fallback for the (now rare) case a profile name has not been saved yet.
 */

/** True when `value` looks like a real name rather than an empty string, a
 * bare email address, or the email's own local part (the provider's
 * placeholder-name fallback). */
export function isRealName(value: string | null | undefined, email?: string | null): boolean {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return false;
  if (trimmed.includes("@")) return false; // a full email address, not a name
  const localPart = (email ?? "").split("@")[0]?.trim().toLowerCase();
  if (localPart && trimmed.toLowerCase() === localPart) return false; // provider's email-local-part fallback
  return true;
}

/**
 * Resolves the best real name available: the profile's own `full_name`
 * first, then the session's name, never an email or its local part.
 * Returns undefined when neither source holds a real name, so callers can
 * greet/display without a name rather than with a fragment of an address.
 */
export function resolveDisplayName(opts: {
  profileName?: string | null;
  sessionName?: string | null;
  email?: string | null;
}): string | undefined {
  const { profileName, sessionName, email } = opts;
  if (isRealName(profileName, email)) return profileName!.trim();
  if (isRealName(sessionName, email)) return sessionName!.trim();
  return undefined;
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
