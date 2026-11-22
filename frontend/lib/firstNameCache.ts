/**
 * G488: the signed-in user's first name, mirrored in localStorage so Home can
 * greet by name on the very first paint of the next launch, before the profile
 * request answers. Same idea as `wd_hide_balances` (a local mirror of a server
 * value, replaced by every fresh answer). Keyed to the email it was cached for,
 * so a different account never sees the previous user's name, and cleared on
 * sign-out (AuthProvider.logout).
 */
export const FIRST_NAME_KEY = "wd_first_name";

interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readCachedFirstName(store: Store | null | undefined, email: string | null | undefined): string | undefined {
  if (!store || !email) return undefined;
  try {
    const parsed = JSON.parse(store.getItem(FIRST_NAME_KEY) ?? "null") as { e?: unknown; n?: unknown } | null;
    if (!parsed || typeof parsed.n !== "string" || !parsed.n.trim()) return undefined;
    if (typeof parsed.e !== "string" || parsed.e.toLowerCase() !== email.toLowerCase()) return undefined;
    return parsed.n.trim();
  } catch {
    return undefined;
  }
}

/** Pass a name to remember it, or null to forget it (the profile resolved and
 * holds no usable first name). */
export function writeCachedFirstName(store: Store | null | undefined, email: string | null | undefined, name: string | null): void {
  if (!store) return;
  try {
    if (name && email) store.setItem(FIRST_NAME_KEY, JSON.stringify({ e: email, n: name }));
    else store.removeItem(FIRST_NAME_KEY);
  } catch {}
}

export function clearCachedFirstName(store: Store | null | undefined): void {
  try { store?.removeItem(FIRST_NAME_KEY); } catch {}
}
