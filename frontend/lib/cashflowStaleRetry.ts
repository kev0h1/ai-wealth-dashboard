// E18: GET /cashflow serves the stored forecast while a worker recompute is
// in flight (a category correction or own-transfer confirmation marks it
// stale for one to three seconds). One quiet refetch about five seconds after
// a stale response; no loop, no visible copy.

export const STALE_CASHFLOW_REFETCH_MS = 5000;

/** Whether to schedule the single quiet refetch for this response. */
export function shouldRefetchStaleCashflow(
  data: { cashflow_stale?: boolean } | null | undefined,
  alreadyRetried: boolean,
): boolean {
  return data?.cashflow_stale === true && !alreadyRetried;
}

/**
 * Schedules the single refetch. `retried()` is called when the timer fires so
 * the caller can mark the retry as spent; `refetch()` does the request. Returns
 * a cancel function.
 */
export function scheduleStaleCashflowRefetch(
  refetch: () => void,
  retried: () => void,
  delayMs: number = STALE_CASHFLOW_REFETCH_MS,
): () => void {
  const id = setTimeout(() => { retried(); refetch(); }, delayMs);
  return () => clearTimeout(id);
}

/**
 * G421 guard: the stale refetch must not overwrite the page while an
 * optimistic planned-delete or dismiss is inside its undo window, or the
 * removed row would reappear. Both refs null means it is safe to apply.
 */
export function canApplyStaleCashflow(
  lastPlannedDelete: unknown | null,
  lastDismiss: unknown | null,
): boolean {
  return lastPlannedDelete === null && lastDismiss === null;
}
