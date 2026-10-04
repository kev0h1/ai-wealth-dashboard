// A108: what the app does when the in-app browser hands a bank consent back by
// deep link (wd:deeplink, dispatched by lib/deepLinks.ts).
import type { DeepLinkDetail } from "@/lib/deepLinks";

export interface ReturnRouter {
  push(href: string): void;
}

// Loaded lazily so this module stays importable by the plain-Node test.
function invalidateAccountData(): void {
  void import("@/lib/accountMutations").then((m) => m.invalidateAllAccountData());
}

// The bank picker registers while mounted so an error return is shown there.
let openSheets = 0;
export function registerBankSheet(): () => void {
  openSheets += 1;
  return () => {
    openSheets = Math.max(0, openSheets - 1);
  };
}

export function handleBankConnectReturn(
  detail: DeepLinkDetail,
  router: ReturnRouter,
  invalidate: () => void = invalidateAccountData,
  sheetOpen: boolean = openSheets > 0,
): void {
  if (detail.kind !== "bank_connected") return;
  if (detail.status === "ok" && detail.connection) {
    invalidate();
    router.push(`/accounts?syncing=1&connection=${encodeURIComponent(detail.connection)}`);
    return;
  }
  if (detail.status === "ok") {
    // No connection id (older hand-off page): still refresh and use the poll's any-account path.
    invalidate();
    router.push("/accounts?syncing=1");
    return;
  }
  // Error: an open bank sheet shows its own message.
  if (!sheetOpen) router.push("/accounts?connect=cancelled");
}
