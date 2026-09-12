/**
 * A tiny FIFO async queue (G45, second re-review, blocker 1).
 *
 * Two overlapping writes to the same server-side field raced: toggle A's
 * PATCH was still in flight when toggle B fired, so B computed its "next"
 * set from a `previous` that only reflected A's OPTIMISTIC local change,
 * not a settled one. When A's write later failed, its own catch restored
 * ITS OWN `previous` snapshot (captured before either toggle happened),
 * silently erasing B even though B's PATCH had already succeeded on the
 * server. Reverting from a captured snapshot after a failure (see
 * app/settings/SettingsPage.tsx's failure path, which now refetches instead)
 * only half-fixes this: the real defect is that A and B were allowed to run
 * concurrently at all.
 *
 * `createSerialQueue().run(fn)` appends `fn` to a chain and guarantees `fn`
 * only starts once every previously queued `fn` has fully SETTLED (resolved
 * or rejected) — never two at once. A caller that always reads the current
 * "previous" state at the top of its own `fn` (rather than capturing it at
 * enqueue time) is then guaranteed to start from state that already
 * reflects every earlier queued write's outcome, including its own
 * failure-path reconciliation — which removes the stale-`previous` problem
 * at the root instead of papering over one failure mode of it.
 *
 * Deliberately framework-free (no React) so it can be tested directly with
 * a plain Node script — see frontend/scripts/serial-queue.test.mjs, which
 * imports this exact file rather than a re-implementation.
 */
export function createSerialQueue() {
  // The tail of the chain. Deliberately normalised to a settled, "value
  // discarded" promise after each item — see the comment in `run` for why a
  // rejection must never propagate onto `tail` itself.
  let tail: Promise<void> = Promise.resolve();

  function run<T>(fn: () => Promise<T> | T): Promise<T> {
    // `fn` runs after `tail` settles, REGARDLESS of whether the previous
    // item resolved or rejected (the second argument to `.then` here) — a
    // failed toggle must never permanently block every toggle queued after
    // it.
    const result = tail.then(fn, fn);

    // Update `tail` to something that resolves once `result` has settled,
    // but whose own rejection (if `fn` throws) is swallowed HERE, not on
    // `result`. If `tail` itself became a rejected promise, every `.then`
    // chained onto it after this point would skip straight to its
    // rejection handler without ever calling the next queued `fn` — this
    // guards that without hiding the rejection from the CALLER of `run`,
    // who still gets it via `result`.
    tail = result.then(
      () => undefined,
      () => undefined
    );

    return result;
  }

  return { run };
}
