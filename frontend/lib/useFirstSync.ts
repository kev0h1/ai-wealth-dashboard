"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type SyncStatus } from "@/lib/api";
import { cachedEndpoint, ENDPOINT, peekEndpoint } from "@/lib/endpointCache";
import { invalidateAllAccountData } from "@/lib/accountMutations";
import { pollDelayMs, shouldPollTick } from "@/lib/syncStatusView";

/** The first-sync gate for screens whose figures depend on the bank pull.
 * Keep the ledger up until the server AND the screen's fresh reads finish.
 * A failed status request is unknown, never proof of an empty pay period. */
export function useFirstSync(onComplete: () => Promise<void>) {
  const [status, setStatus] = useState<SyncStatus | null>(() => peekEndpoint<SyncStatus>(ENDPOINT.syncStatus.key) ?? null);
  const [error, setError] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [checked, setChecked] = useState(false);
  const [figuresError, setFiguresError] = useState(false);
  const checkedRef = useRef(false);
  const statusRef = useRef(status);
  const onCompleteRef = useRef(onComplete);
  const mounted = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const retryInFlight = useRef(false);
  useEffect(() => { onCompleteRef.current = onComplete; });

  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const request = (async () => {
      try {
        const next = await cachedEndpoint(ENDPOINT.syncStatus.key, () => api.getSyncStatus(), { force: true });
        if (!mounted.current) return;
        const previous = statusRef.current;
        const needsInitialFigures = !checkedRef.current && next.state === "idle" && next.has_connections === true
          && (!previous || previous.first_sync !== false || previous.has_connections !== true);
        if ((previous && previous.state !== "idle" && next.state === "idle") || needsInitialFigures) {
          invalidateAllAccountData();
          try {
            await onCompleteRef.current();
          } catch (cause) {
            if (mounted.current) setFiguresError(true);
            throw cause;
          }
          if (!mounted.current) return;
        }
        statusRef.current = next;
        checkedRef.current = true;
        setChecked(true);
        setStatus(next);
        setFiguresError(false);
        setError(false);
      } catch {
        if (mounted.current) setError(true);
      }
    })().finally(() => { if (inFlight.current === request) inFlight.current = null; });
    inFlight.current = request;
    return request;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const delay = pollDelayMs(status?.state);
  useEffect(() => {
    if (delay == null) return;
    const id = window.setInterval(() => {
      if (shouldPollTick({ visible: document.visibilityState === "visible", inFlight: inFlight.current !== null, cancelled: !mounted.current })) void refresh();
    }, delay);
    return () => window.clearInterval(id);
  }, [delay, refresh]);

  const retry = useCallback(async () => {
    if (retryInFlight.current) return;
    retryInFlight.current = true;
    setRetrying(true);
    try {
      await api.syncAccounts();
    } catch {
      // The authoritative status still describes the failed or running job.
    }
    await refresh();
    retryInFlight.current = false;
    if (mounted.current) setRetrying(false);
  }, [refresh]);

  const active = status?.first_sync === true && status.state !== "idle";
  return { status, active, pending: !checked || status === null || figuresError, error, figuresError, retrying, retry, refresh };
}
