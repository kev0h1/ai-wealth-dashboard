// A108: what the app does when the in-app browser hands a bank consent back by
// deep link (wd:deeplink, dispatched by lib/deepLinks.ts).
import type { DeepLinkDetail } from "@/lib/deepLinks";

export interface ReturnRouter {
  push(href: string): void;
}

export interface ReturnOptions {
  invalidate?: () => void;
  sheetOpen?: boolean;
  /** Mid-flow (Onboarding): refresh data but do not navigate away. */
  stay?: boolean;
  now?: () => number;
  /** False when signed out: the return is stashed for replay after sign-in. */
  hasToken?: () => boolean;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
}

// Loaded lazily so this module stays importable by the plain-Node test.
function invalidateAccountData(): void {
  void import("@/lib/accountMutations").then((m) => m.invalidateAllAccountData());
}

// The bank picker registers while mounted so an error return is shown there.
// stayOnReturn (Onboarding) suppresses the navigation on an ok return.
let openSheets = 0;
let staySheets = 0;
export function registerBankSheet(opts: { stayOnReturn?: boolean } = {}): () => void {
  openSheets += 1;
  if (opts.stayOnReturn) staySheets += 1;
  return () => {
    openSheets = Math.max(0, openSheets - 1);
    if (opts.stayOnReturn) staySheets = Math.max(0, staySheets - 1);
  };
}

// D2: the hand-off button after an auto-return fires the same link twice.
const DEDUPE_MS = 10_000;
const seen = new Map<string, number>();
export function resetBankReturnDedupe(): void {
  seen.clear();
}
function isDuplicate(key: string, now: number): boolean {
  for (const [k, t] of seen) if (now - t > DEDUPE_MS) seen.delete(k);
  if (seen.has(key)) return true;
  seen.set(key, now);
  return false;
}

// D3: a signed-out cold-start return is kept until a session exists.
export const PENDING_BANK_RETURN_KEY = "wd_pending_bank_return";
export function stashPendingReturn(storage: ReturnOptions["storage"], detail: DeepLinkDetail): void {
  try {
    storage?.setItem(PENDING_BANK_RETURN_KEY, JSON.stringify(detail));
  } catch {}
}
export function takePendingReturn(storage: ReturnOptions["storage"]): DeepLinkDetail | null {
  try {
    const raw = storage?.getItem(PENDING_BANK_RETURN_KEY);
    if (!raw) return null;
    storage?.removeItem(PENDING_BANK_RETURN_KEY);
    const d = JSON.parse(raw) as DeepLinkDetail;
    return d && d.kind === "bank_connected" ? d : null;
  } catch {
    return null;
  }
}

export function handleBankConnectReturn(
  detail: DeepLinkDetail,
  router: ReturnRouter,
  opts: ReturnOptions = {},
): void {
  if (detail.kind !== "bank_connected") return;
  const now = (opts.now ?? Date.now)();
  const sheetOpen = opts.sheetOpen ?? openSheets > 0;
  const stay = opts.stay ?? staySheets > 0;
  const invalidate = opts.invalidate ?? invalidateAccountData;
  if (isDuplicate(`${detail.status}:${detail.connection ?? ""}`, now)) return;
  if (detail.status === "ok") {
    if (opts.hasToken && !opts.hasToken()) {
      stashPendingReturn(opts.storage, detail);
      return;
    }
    invalidate();
    if (stay) return;
    router.push(
      detail.connection
        ? `/accounts?syncing=1&connection=${encodeURIComponent(detail.connection)}`
        : "/accounts?syncing=1",
    );
    return;
  }
  // Error: an open bank sheet shows its own message.
  if (!sheetOpen) router.push("/accounts?connect=cancelled");
}
