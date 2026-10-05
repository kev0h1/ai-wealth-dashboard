// D12: when onboarding may be shown. Only an explicit `onboarding_complete ===
// false` from a profile that actually loaded counts. A failed or slow fetch
// (null), a missing field, or a shape without the flag never sends an existing
// user back through onboarding. A per-user localStorage flag, set the first
// time a profile reports complete (or onboarding finishes), is a second guard.
export interface ProfileLike {
  onboarding_complete?: boolean | null;
}

export function needsOnboarding(profile: ProfileLike | null | undefined): boolean {
  return !!profile && profile.onboarding_complete === false;
}

const KEY_PREFIX = "wd_onboarded:";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem"> | null | undefined;
const keyFor = (email: string) => KEY_PREFIX + email.trim().toLowerCase();

export function isMarkedOnboarded(store: Store, email: string | null | undefined): boolean {
  if (!email) return false;
  try { return store?.getItem(keyFor(email)) === "1"; } catch { return false; }
}
export function markOnboarded(store: Store, email: string | null | undefined): void {
  if (!email) return;
  try { store?.setItem(keyFor(email), "1"); } catch {}
}
/** Called on account deletion only. */
export function clearOnboarded(store: Store, email: string | null | undefined): void {
  if (!email) return;
  try { store?.removeItem(keyFor(email)); } catch {}
}

/** The one decision AuthProvider makes. */
export function shouldShowOnboarding(
  profile: ProfileLike | null | undefined,
  store: Store,
  email: string | null | undefined,
): boolean {
  if (profile && profile.onboarding_complete === true) markOnboarded(store, email);
  if (isMarkedOnboarded(store, email)) return false;
  return needsOnboarding(profile);
}
