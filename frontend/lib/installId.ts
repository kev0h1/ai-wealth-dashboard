// G473: a stable id for THIS app install, created once and kept in the same
// webview storage as the push token (wd_push_token). It is sent with push
// registration so the backend can replace this install's old token when the OS
// rotates it, instead of storing a second one and pushing twice to one phone.
//
// It deliberately survives sign-out (signing out must not revoke or forget the
// install, and unregisterCapacitorPush never touches it); clearing the app's
// storage or reinstalling mints a new one, which is the correct "new install".
// Plain localStorage, not a Capacitor plugin proxy, so there is nothing
// thenable to return from an async function.
export const INSTALL_ID_STORAGE_KEY = "wd_install_id";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const VALID = /^[A-Za-z0-9_-]{8,64}$/;

function mint(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback for a webview without randomUUID: random, not guessable by design.
  const rand = () => Math.random().toString(36).slice(2, 12);
  return `i${Date.now().toString(36)}${rand()}${rand()}`;
}

export function getInstallId(storage?: StorageLike | null): string | null {
  let store: StorageLike | null | undefined = storage;
  if (store === undefined) {
    try { store = typeof localStorage !== "undefined" ? localStorage : null; } catch { store = null; }
  }
  if (!store) return null; // no storage: send nothing, the backend treats it as an older client
  try {
    const existing = store.getItem(INSTALL_ID_STORAGE_KEY);
    if (existing && VALID.test(existing)) return existing;
    const fresh = mint();
    store.setItem(INSTALL_ID_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return null;
  }
}
