/**
 * One reusable shape for "save a single preference field to the server",
 * extracted from what G45 (cover-plan exclusions), G52 (notification
 * prefs) and G58 (child benefit) each converged on independently, one
 * field at a time, in app/settings/SettingsPage.tsx (see the block
 * comments on runCoverToggle, runNotifToggle and runChildBenefitToggle
 * there). G60 moves the ten remaining call sites still doing an
 * optimistic setState + `api.updatePreferences(...).catch(() => {})` onto
 * this instead of writing an eleventh, twelfth… bespoke copy.
 *
 * The shape, unchanged from what those three items settled on:
 *
 *  1. The caller computes `next` itself, in its own event handler — this
 *     module never receives a React state updater and has no way to run
 *     one, so "compute inside a state updater" (impure, can fire the save
 *     twice or not at all) simply isn't representable here.
 *  2. Writes to one field are serialized: each saver is handed a `queue`
 *     (a `lib/serialQueue.ts` `createSerialQueue()`, the same one G45
 *     introduced) — calling `.run(next)` twice before the first has settled
 *     queues the second rather than racing it, so a toggle's own `previous`
 *     is always read from settled state. The queue is a caller-supplied
 *     dependency rather than something this module creates internally, on
 *     purpose: it keeps this file import-free (see its own testability note
 *     below), and matches the existing call-site convention this module
 *     generalises — SettingsPage.tsx already creates `coverSaveQueue`/
 *     `notifSaveQueue` itself via `useRef(createSerialQueue()).current`.
 *  3. `previous` is read via `deps.getCurrent()` at the top of the queued
 *     function, not captured by the caller at enqueue time — by the time a
 *     queued write actually starts, an earlier one may have changed the
 *     true value, including via its own failure-path reconciliation.
 *  4. On failure: revert. The server is asked what it actually holds
 *     (`deps.reconcile()`) rather than restoring the locally-captured
 *     `previous` unconditionally — a failed write on this device doesn't
 *     mean the server rejected everything, and a captured snapshot can be
 *     stale relative to a write that has already succeeded elsewhere.
 *     Only when reconciliation itself has no server truth to offer
 *     (`undefined` — the refetch failed, or its snapshot was discarded as
 *     stale by `lib/preferencesVersion.ts`) does this fall back to
 *     `previous`. This fallback took three separate rejections across
 *     G45's own re-reviews to get right; see runCoverToggle's comment in
 *     SettingsPage.tsx for the full history. Losing it here would silently
 *     regress every field this module is used for at once.
 *  5. A successful write reports its `version` via `deps.noteVersion`
 *     (typically `PreferencesContext`'s `notePreferencesVersion`) so a
 *     slower, now-stale GET landing later is rejected by the version
 *     scheme rather than clobbering this write.
 *  6. `deps.onError` is called with `null` at the start of every attempt
 *     (clearing a previous failure message so a retry doesn't show a stale
 *     one) and with a message string if the attempt fails. It is never
 *     called with a message on success — see this module's own docstring
 *     note below on why success and failure are treated asymmetrically.
 *
 * Deliberately framework-free (no React, and no import of its own — see
 * PreferenceQueue below) so it can be tested directly with a plain Node
 * script, the same pattern as lib/serialQueue.ts and
 * lib/preferencesVersion.ts — see scripts/preference-save.test.mjs, which
 * imports this exact file (and the real lib/serialQueue.ts for `queue`)
 * rather than a re-implementation of either.
 *
 * On auto-clearing (G60, folding in a G58-review finding): success
 * messages that already existed before this module (e.g. SettingsPage's
 * `financeMsg`, "Saved") auto-clear after a couple of seconds, but failure
 * messages never did — an asymmetry the G58 review flagged without fixing.
 * This module settles it once, for every field: failure messages are left
 * showing until the user's next attempt (see point 6 above), on the view
 * that a persistent error sitting next to a control the user can retry is
 * more honest than one that quietly disappears while the field is still
 * wrong; timing out an error risks a user glancing back moments later at a
 * screen that has gone quiet and reading that as "it must be fine now".
 * Success, when a caller chooses to show it at all, is still the caller's
 * own responsibility to clear (via `onSuccess`) — most of the ten sites
 * this module now serves don't render a success line at all, only a
 * failure one, so there is nothing to time out.
 */

/** Structural match for `lib/serialQueue.ts`'s `createSerialQueue()` return
 * value — a type, not an import, so this module has no dependency of its
 * own (see the module docstring). Any object with this shape works,
 * including a hand-rolled one in a test. */
export interface PreferenceQueue {
  run: <T>(fn: () => Promise<T> | T) => Promise<T>;
}

export interface PreferenceSaverDeps<T> {
  /** Serializes writes for this one field — see point 2 above. Almost
   * always `createSerialQueue()` from `lib/serialQueue.ts`, created once
   * per field (e.g. `useRef(createSerialQueue()).current`) and never
   * shared between fields. */
  queue: PreferenceQueue;
  /** Reads the current, settled value — must read from a ref (or
   * equivalent stable current-value holder), never a value captured at
   * `run()`-call time, so a queued save always starts from state that
   * already reflects every earlier queued save's outcome. */
  getCurrent: () => T;
  /** Applies a value to local/UI state (and any side-channel that must
   * stay in step with it, e.g. localStorage). Called for the optimistic
   * value before the save starts, and again for whatever value the save
   * or its failure-path reconciliation resolves to. */
  apply: (value: T) => void;
  /** Issues the write for this one field (typically a scoped
   * `api.updatePreferences({ field: value })` call). May resolve void, or
   * with an object carrying the response's `version`. */
  save: (value: T) => Promise<{ version?: number | null } | void>;
  /** Refetches server truth and returns the value for THIS field, or
   * `undefined` if there is none to offer (the refetch failed, or its
   * snapshot was discarded as stale) — see point 4 above. Callers with
   * nowhere to reconcile from (no server-truth channel available, e.g.
   * Onboarding, which runs outside PreferencesContext) may pass
   * `async () => undefined`, which makes every failure fall back to
   * `previous`. */
  reconcile: () => Promise<T | undefined>;
  /** Reports a successful write's version, typically
   * PreferencesContext's `notePreferencesVersion`. Omit where there is no
   * version scheme to participate in (Onboarding). */
  noteVersion?: (version: number | null | undefined) => void;
  /** `null` to clear a prior failure message, a string to show a new one.
   * Omit for a caller with nowhere to show it (see this module's own
   * docstring on the sites that fall into this — the value is still
   * always corrected via `apply`, only the message is unavailable). */
  onError?: (message: string | null) => void;
  /** Called once a write has fully succeeded. Optional — most of this
   * module's callers use it only to gate their own next step (Onboarding)
   * or don't need it at all. */
  onSuccess?: () => void;
  /** Overrides the default failure message. */
  failureMessage?: string;
}

const DEFAULT_FAILURE_MESSAGE = "Could not save that change. Try again.";

export interface PreferenceSaver<T> {
  /** Enqueues a write of `next`. Never overlaps another `run()` on the
   * same saver — see point 2 above. */
  run: (next: T) => Promise<void>;
  /** True for the duration of a queued attempt (optimistic apply through
   * to its save/reconcile settling) — the same idiom
   * `savingChildBenefitRef` used in SettingsPage.tsx, exposed generically
   * here so a caller can gate an unrelated sync effect (e.g. one that
   * re-derives this same field from a raw preferences snapshot) against
   * clobbering a write that is still in flight. Not a React ref: a plain
   * mutable holder, since a component wanting reactive re-renders on it
   * should derive its own state from `onError`/`onSuccess` instead. */
  isSaving: { current: boolean };
}

export function createPreferenceSaver<T>(deps: PreferenceSaverDeps<T>): PreferenceSaver<T> {
  const isSaving = { current: false };

  function run(next: T): Promise<void> {
    return deps.queue.run(async () => {
      // Point 3: read via getCurrent(), not a value closed over by the
      // caller when it decided to call run() — an earlier queued write may
      // have moved the true value on since then.
      const previous = deps.getCurrent();
      deps.apply(next);
      deps.onError?.(null);
      isSaving.current = true;
      try {
        const response = await deps.save(next);
        if (response && typeof (response as { version?: number | null }).version !== "undefined") {
          deps.noteVersion?.((response as { version?: number | null }).version);
        }
        deps.onSuccess?.();
      } catch {
        // Point 4: server-first, previous only as a last resort.
        const server = await deps.reconcile();
        if (server !== undefined) {
          deps.apply(server);
        } else {
          deps.apply(previous);
        }
        deps.onError?.(deps.failureMessage ?? DEFAULT_FAILURE_MESSAGE);
      } finally {
        isSaving.current = false;
      }
    });
  }

  return { run, isSaving };
}
