/**
 * G488: when Home may say something empty. Each gate answers "has the data this
 * copy depends on actually arrived?", so a cold launch shows skeletons and a
 * failed read shows its error, never "Nothing needs you today" or "Connect your
 * first bank" by default.
 */
export type RequestStatus = "loading" | "ready" | "failed";

/** Penny's line on Home depends on Left to spend, the companion items and the
 * sync status (which decides whether a verdict is withheld). */
export function briefGate(o: {
  loading: boolean;
  stsLoading: boolean;
  todaySettled: boolean;
  syncStatusKnown: boolean;
  syncStatusError: boolean;
  loadError: boolean;
  stsError: boolean;
  todayStatus: RequestStatus;
}): "loading" | "failed" | "ready" {
  if (o.loading || o.stsLoading || !o.todaySettled || (!o.syncStatusKnown && !o.syncStatusError)) return "loading";
  if (!o.loadError && (o.stsError || o.todayStatus === "failed")) return "failed";
  return "ready";
}

/** "No accounts" is a conclusion only once the account list has answered
 * successfully. A failed or unfinished read is neither empty nor fresh. */
export function accountsGenuinelyEmpty(o: {
  loading: boolean;
  loadError: boolean;
  accountsStatus: RequestStatus;
  accountCount: number;
  investmentCount: number;
  hasConnectionEvidence: boolean;
}): boolean {
  return !o.loading && !o.loadError && o.accountsStatus === "ready"
    && o.accountCount === 0 && o.investmentCount === 0 && !o.hasConnectionEvidence;
}

/** Home's Recent Transactions card. "No transactions yet" needs both the
 * transactions request and the account list to have answered. */
export function recentActivityState(o: {
  txLoading: boolean;
  accountsLoading: boolean;
  error: string | null;
  pendingCount: number;
  recentCount: number;
}): "loading" | "error" | "empty" | "rows" {
  if (o.txLoading) return "loading";
  if (o.error) return "error";
  if (o.pendingCount === 0 && o.recentCount === 0) return o.accountsLoading ? "loading" : "empty";
  return "rows";
}
