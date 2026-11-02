"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, type Account, type SyncStatus } from "@/lib/api";
import {
  accountsFreshness, advancedTimestampSignature, isRefreshEligible, isConnectedBankAccount, RATE_LIMIT_COOLDOWN_MS, refreshBaseline, refreshCooldown,
  refreshCooldownMessage, refreshProgress, REFRESH_POLL_MS, REFRESH_TIMEOUT_MS,
  syncFailureKey, syncFailureMessage, type RefreshBaseline,
} from "@/lib/accountsOverviewRefresh";
import { invalidateAllAccountData } from "@/lib/accountMutations";

export interface AccountsOverviewRefreshOptions {
  accounts: Account[];
  canConnectBank: boolean;
  loading: boolean;
  syncStatus: SyncStatus | null;
  refreshSyncStatus: () => Promise<void>;
  reload: () => Promise<void>;
}

export interface AccountsOverviewRefreshState {
  refresh: () => Promise<void>;
  busy: boolean;
  disabled: boolean;
  message: string;
  freshness: string;
}

const REQUEST_ACCEPTED = "Refresh requested. We’ll check for updated bank data.";
const REQUESTING = "Requesting a bank refresh…";

/**
 * Owns the deliberately conservative overview-refresh lifecycle. `reload` is
 * only called after a changed `bank_synced_to`, never merely because sync work
 * has gone idle or a request has been accepted.
 */
export function useAccountsOverviewRefresh({
  accounts, canConnectBank, loading, syncStatus, refreshSyncStatus, reload,
}: AccountsOverviewRefreshOptions): AccountsOverviewRefreshState {
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const [message, setMessage] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [localCooldownUntil, setLocalCooldownUntil] = useState<number | null>(null);
  const baselineRef = useRef<RefreshBaseline | null>(null);
  const pollStartedAtRef = useRef<number | null>(null);
  const pollInFlightRef = useRef(false);
  const requestInFlightRef = useRef(false);
  const reloadedSignatureRef = useRef("");
  const observedProgressRef = useRef<"waiting" | "updated" | "partial">("waiting");
  const startingFailureKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const bankCooldownAt = useMemo(() => refreshCooldown(accounts, clock), [accounts, clock]);
  const cooldownAt = localCooldownUntil && localCooldownUntil > clock
    ? bankCooldownAt === null ? localCooldownUntil : Math.max(bankCooldownAt, localCooldownUntil)
    : bankCooldownAt;
  const eligibleCount = useMemo(() => accounts.filter(isRefreshEligible).length, [accounts]);
  const freshness = useMemo(() => accountsFreshness(accounts, clock), [accounts, clock]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    if (!cooldownAt) return;
    const delay = cooldownAt - Date.now();
    const timer = window.setTimeout(() => setClock(Date.now()), Math.max(0, Math.min(delay + 100, 2_147_000_000)));
    return () => window.clearTimeout(timer);
  }, [cooldownAt]);

  const disabled = loading || busy || !canConnectBank || eligibleCount === 0 || cooldownAt !== null;

  useEffect(() => {
    if (!polling || !baselineRef.current) return;
    const failureKey = syncFailureKey(syncStatus);
    if (failureKey && failureKey !== startingFailureKeyRef.current) {
      setBusy(false);
      setPolling(false);
      setMessage(syncFailureMessage(syncStatus)!);
    }
  }, [polling, syncStatus]);

  const refresh = useCallback(async () => {
    if (requestInFlightRef.current || loading || busy || !canConnectBank || eligibleCount === 0 || cooldownAt !== null) return;
    requestInFlightRef.current = true;
    baselineRef.current = refreshBaseline(accounts);
    pollStartedAtRef.current = Date.now();
    reloadedSignatureRef.current = "";
    observedProgressRef.current = "waiting";
    startingFailureKeyRef.current = syncFailureKey(syncStatus);
    setBusy(true);
    setMessage(REQUESTING);
    try {
      const result = await api.syncAccounts();
      if (!mountedRef.current) return;
      setClock(Date.now());
      if (result.paused) {
        setBusy(false);
        setPolling(false);
        setMessage("Bank refresh is paused for your current plan.");
      } else {
        setMessage(REQUEST_ACCEPTED);
        setPolling(true);
      }
    } catch (error) {
      if (!mountedRef.current) return;
      setClock(Date.now());
      setBusy(false);
      setPolling(false);
      pollStartedAtRef.current = null;
      if (error instanceof ApiError && error.status === 429) {
        setLocalCooldownUntil(Date.now() + RATE_LIMIT_COOLDOWN_MS);
        setMessage("Please try again soon.");
      } else {
        setMessage("We could not request a refresh just now. Try again soon.");
      }
    } finally {
      requestInFlightRef.current = false;
    }
  }, [accounts, busy, canConnectBank, cooldownAt, eligibleCount, loading, syncStatus]);

  useEffect(() => {
    if (!polling || !baselineRef.current) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || document.visibilityState !== "visible" || pollInFlightRef.current) return;
      if ((pollStartedAtRef.current ?? Date.now()) + REFRESH_TIMEOUT_MS <= Date.now()) {
        setBusy(false);
        setPolling(false);
        setMessage(observedProgressRef.current === "partial"
          ? "Some bank data updated. The rest has not arrived yet."
          : "We’re still waiting for updated bank data. Some bank times may take longer to arrive.");
        return;
      }
      pollInFlightRef.current = true;
      try {
        // Keep the page's existing status model current, but its idle state is
        // not evidence that Finexer has supplied newer account data.
        await Promise.all([refreshSyncStatus(), api.accounts().then((next) => {
          if (cancelled) return;
          const progress = refreshProgress(next, baselineRef.current!);
          observedProgressRef.current = progress;
          const signature = advancedTimestampSignature(next, baselineRef.current!);
          if (signature && signature !== reloadedSignatureRef.current) {
            reloadedSignatureRef.current = signature;
            invalidateAllAccountData();
            void reload();
          }
          if (progress === "updated") {
            setBusy(false);
            setPolling(false);
            setMessage("Bank data updated.");
          } else if (progress === "partial") {
            setMessage("Some bank data updated. The rest has not arrived yet.");
          }
        })]);
      } catch {
        // A transient GET failure must not erase the baseline or falsely say a
        // bank failed. The next visible tick can still confirm its data.
      } finally {
        pollInFlightRef.current = false;
      }
    };
    void tick();
    const interval = window.setInterval(() => { void tick(); }, REFRESH_POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [polling, refreshSyncStatus, reload]);

  let neutralMessage = message;
  if (!neutralMessage) {
    if (loading) neutralMessage = "Loading bank accounts.";
    else if (!canConnectBank) neutralMessage = "Bank refresh is not available on your current plan.";
    else if (eligibleCount === 0 && accounts.some((account) => !account.manual && !account.id.startsWith("statement-") && !!account.connection_id && account.paused)) neutralMessage = "Bank refresh is paused for your current plan.";
    else if (eligibleCount === 0 && accounts.some(account => isConnectedBankAccount(account) && account.balance_only)) neutralMessage = "These accounts share balances only. Bank refresh is unavailable.";
    else if (eligibleCount === 0 && canConnectBank) neutralMessage = "Connect a bank to refresh its data.";
    else if (eligibleCount === 0) neutralMessage = "No bank accounts are available to refresh.";
    else if (cooldownAt !== null) neutralMessage = refreshCooldownMessage(cooldownAt);
    else if (syncFailureMessage(syncStatus)) neutralMessage = syncFailureMessage(syncStatus)!;
    else neutralMessage = "Ready to refresh your connected bank data.";
  }
  if (cooldownAt !== null && neutralMessage !== refreshCooldownMessage(cooldownAt)) neutralMessage = `${neutralMessage} ${refreshCooldownMessage(cooldownAt)}`;

  return { refresh, busy, disabled, message: neutralMessage, freshness };
}
