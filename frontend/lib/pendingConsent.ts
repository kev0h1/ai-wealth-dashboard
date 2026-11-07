// A193: a bank consent the app started and has not seen finish. On Android with
// battery saver the phone can close Sorted while the user is at the bank, and a
// reloaded bank page then says "invalid request". The consent id is kept in
// localStorage (it survives a killed process, unlike memory) and the SERVER is
// asked how that consent ended on the next launch (GET /auth/finexer/pending).
// The old consent URL is never re-opened: Try again always creates a fresh one.

export const PENDING_CONSENT_KEY = "wd_pending_consent";
export const PENDING_CONSENT_TTL_MS = 30 * 60 * 1000;

export const CONSENT_INTERRUPTED_MESSAGE =
  "Your bank’s app couldn’t open. If battery saver or restricted battery use is on for your bank’s app, turn it off for that app, or try again in your browser.";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem"> | null | undefined;

export interface PendingConsent {
  connectionId: string;
  providerId?: string;
  at: number;
}

export function markPendingConsent(
  storage: Store,
  connectionId: string | undefined,
  providerId: string | undefined,
  now: number = Date.now(),
): void {
  if (!connectionId) return;
  try {
    storage?.setItem(PENDING_CONSENT_KEY, JSON.stringify({ connectionId, providerId, at: now }));
  } catch {}
}

export function clearPendingConsent(storage: Store): void {
  try { storage?.removeItem(PENDING_CONSENT_KEY); } catch {}
}

export function readPendingConsent(storage: Store, now: number = Date.now()): PendingConsent | null {
  try {
    const raw = storage?.getItem(PENDING_CONSENT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingConsent;
    if (!p || typeof p.connectionId !== "string" || typeof p.at !== "number" || now - p.at > PENDING_CONSENT_TTL_MS) {
      storage?.removeItem(PENDING_CONSENT_KEY);
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

export interface PendingConsentServerState {
  connection_id: string | null;
  status: string | null;
  provider?: string | null;
}

export type ResumeOutcome =
  | { kind: "none" }
  | { kind: "connected"; connectionId: string }
  | { kind: "failed"; providerId?: string };

/** Cold start: if a consent was left unfinished, ask the server how it ended. The
 *  marker is consumed either way, so one consent is reported at most once. */
export async function resolvePendingConsent(
  storage: Store,
  fetchPending: () => Promise<PendingConsentServerState>,
  now: number = Date.now(),
): Promise<ResumeOutcome> {
  const marker = readPendingConsent(storage, now);
  if (!marker) return { kind: "none" };
  let server: PendingConsentServerState;
  try {
    server = await fetchPending();
  } catch {
    // Offline or signed out: keep the marker for the next launch.
    return { kind: "none" };
  }
  clearPendingConsent(storage);
  // The user already started a newer consent: that one owns the outcome.
  if (server.connection_id !== marker.connectionId) return { kind: "none" };
  if (server.status === "authorized") return { kind: "connected", connectionId: marker.connectionId };
  // Still pending (the user is back in the app without finishing) or cancelled.
  return { kind: "failed", providerId: marker.providerId };
}
