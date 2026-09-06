"use client";

// Penny's conversation as a bottom sheet, app-wide. Replaces `/penny` as the
// nav's front door (see BottomNav.tsx's Penny button) — the hub itself
// survives as a destination reached FROM inside the sheet (the "Your plan
// and updates" row in PennySheet.tsx's header), not the other way round.
//
// Why the conversation's own message state survives close/reopen without
// this provider holding a duplicate copy of it: <PennySheet /> below is
// rendered unconditionally by this provider (mounted once, for the life of
// the session) and in turn always renders <PennyConversation inSheet .../>
// — `isOpen` only toggles CSS visibility (see PennySheet.tsx), never
// mounts/unmounts that subtree. PennyConversation already caps its own
// history (HISTORY_CAP in components/PennyConversation.tsx); since it's
// never torn down, that cap is the only one that's needed here — there is
// no second array to cap. Nothing here reaches for localStorage: the
// conversation is financial content, and in-memory-for-the-session (gone on
// a hard refresh) is the deliberate choice.
//
// `openSeq` exists for a trap that only shows up on a SECOND open: since
// PennyConversation is one instance for the whole session (the point of the
// above), any one-shot "submit on open" guard built from a plain ref (the
// first version of this feature used `useRef(false)`) fires once ever, not
// once per open — the first `open({ask: ...})` of a session works, every
// later one silently does nothing (composer opens empty, no error). A
// monotonic counter that increments on EVERY `open()` call, including
// reopens of an already-open sheet, gives PennyConversation something that
// actually changes each time, so it can key its one-shot effects off "has
// THIS open been handled" rather than "has this component ever fired
// once". See PennySheet.tsx (passes it through as `askSeq`) and
// PennyConversation.tsx's `askSeq`-guarded effects.
//
// STATE MODEL (rewritten 2026-08-25, impeccable review HIGH finding): this
// used to be a plain React Context, `<PennySheetContext.Provider>` wrapping
// `{children}` via a `useState` trio (isOpen/ctx/openSeq) in this component.
// That broke the moment Sidebar.tsx needed a Penny trigger of its own:
// app/layout.tsx renders `<Sidebar />` as a SIBLING BEFORE
// `<PennySheetProvider>` opens, not as a descendant of it (see that file's
// own comment on why the provider wraps #app-shell specifically, for the
// `.sheet-open` blur contract), so `useContext` inside Sidebar would always
// see `null` and throw "must be used within PennySheetProvider" — a real
// runtime crash on every page, not a hypothetical. Fixing that by editing
// app/layout.tsx's tree order was out of scope (not an owned file for that
// change); the fix instead lives entirely here: the sheet's state is now a
// module-level singleton (`sheetState`/`listeners` below) read via
// `useSyncExternalStore`, not a React Context value. A module-level
// singleton is already the right shape for this — the whole point of this
// file, stated above, is exactly ONE Penny sheet for the entire session
// regardless of who opens it — `useSyncExternalStore` just makes that true
// regardless of where in the render tree a caller happens to sit, instead
// of accidentally depending on DOM nesting no consumer was ever supposed to
// care about. `PennySheetProvider` itself is now a thin wrapper (render
// `children`, mount `<PennySheet />` once) kept only so app/layout.tsx and
// every existing call site don't need to change; nothing here strictly
// requires being called "inside" it any more.

import { useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import type { SubscriptionInfo } from "@/lib/api";
import PennySheet from "./PennySheet";

export type PennyAskContext = {
  // "grow" and "debt" added 2026-08-25 for the screen-aware header
  // links/chips feature (lib/pennyScreenConfig.tsx) — both turned out to be
  // real, separate routes (/grow, /debt-plan) on a route survey done for
  // that work, not sub-views of Planning as assumed going in. See
  // BottomNav.tsx's screenForPathname for where these two get produced.
  // Grow folded into Planning 2026-09-04 (/grow now just redirects there),
  // but "grow" stays in this union: PennyConversation.tsx's newBuckets()
  // keys a per-screen thread bucket off every member here, so removing it
  // cascades into that file too (outside this change's file ownership) —
  // left as an inert, unreachable value instead (BottomNav.tsx's
  // screenForPathname's "/grow" case is correspondingly inert, matching the
  // route now redirecting before that case is ever reached).
  // "accounts" added 2026-08-26 for the accounts redesign's Penny entry
  // point (lib/pennyScreenConfig.tsx already had a config entry waiting on
  // this exact addition — see that file's `ConfigScreenKey` comment).
  screen: "planning" | "upcoming" | "tax" | "home" | "spend" | "insights" | "grow" | "debt" | "accounts" | "other";
  /** One short line describing what the user was looking at when they
   * opened the sheet from that screen. Decorative context for the
   * conversation, not required. */
  summary?: string;
  /** A question to submit immediately on open (mirrors PennyConversation's
   * existing `?ask=` deep-link convention, just carried in memory instead
   * of a query string). */
  ask?: string;
};

type SheetState = {
  isOpen: boolean;
  ctx: PennyAskContext | undefined;
  /** Increments on every `open()` call, including a call while the sheet
   * is already open. Internal only (see `usePennySheetState` below) — the
   * public `usePennySheet` hook doesn't expose it, callers never need to
   * read or pass it themselves. */
  openSeq: number;
};

// Module scope, not component state — see this file's header comment
// ("STATE MODEL") for why. One object for the whole app; every hook call
// below reads/writes this same reference, regardless of which component
// tree it's called from.
let sheetState: SheetState = { isOpen: false, ctx: undefined, openSeq: 0 };
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}
// useSyncExternalStore's subscribe contract: return the unsubscribe fn.
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
// Must return a referentially stable value when nothing has changed (React
// re-runs this on every render to decide whether to re-render) — returning
// the module-level `sheetState` object itself, not a freshly-constructed
// copy, satisfies that: it only changes identity when `open()`/`close()`
// below actually reassign it. Used as both the client AND server snapshot
// (see the `useSyncExternalStore` calls below): server and client agree at
// cold start (`{isOpen: false, ctx: undefined, openSeq: 0}`), so one
// function correctly serves both without a hydration mismatch.
function getSnapshot(): SheetState {
  return sheetState;
}

function open(next?: PennyAskContext) {
  sheetState = { ctx: next, isOpen: true, openSeq: sheetState.openSeq + 1 };
  notify();
}
function close() {
  if (!sheetState.isOpen) return; // no-op on an already-closed sheet — skip the redundant notify/re-render
  sheetState = { ...sheetState, isOpen: false };
  notify();
}

/** Public API — the only thing other components should import from this
 * file besides the provider itself and the PennyAskContext type. Safe to
 * call from anywhere in the tree (see this file's header comment) — no
 * provider ancestor required any more. */
export function usePennySheet(): {
  isOpen: boolean;
  open: (ctx?: PennyAskContext) => void;
  close: () => void;
} {
  const { isOpen } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { isOpen, open, close };
}

/** Internal — PennySheet.tsx also needs the current ask context (not just
 * open/close), which the public hook above deliberately doesn't expose to
 * every caller. */
export function usePennySheetState(): SheetState & { open: typeof open; close: typeof close } {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...snap, open, close };
}

// ── PENNY USAGE (2026-09-06, usage ring round) — the sheet header's ring
// (PennySheet.tsx) and the composer's resting state (PennyConversation.tsx)
// both need the same /subscription usage figures, but live in different
// components with no ref/context wired between them — same shape of problem
// `sheetState` above already solved for open/closed, so this reuses that
// exact module-level-singleton + useSyncExternalStore pattern rather than
// inventing a second mechanism. One fetch, shared everywhere; no consumer
// re-fetches its own copy. ──────────────────────────────────────────────

export type PennyUsage = {
  /** Last successful GET /subscription response, or null before the first
   * fetch (or if every fetch so far has failed) — consumers treat null the
   * same as "no ring yet" / "composer never rests" (see `capped` below,
   * which is independently derived, so a stale/missing `info` alone can
   * never wrongly rest the composer). */
  info: SubscriptionInfo | null;
  /** Whether Penny's composer should be in its resting state right now.
   * True either because the last /subscription fetch showed
   * `usage.penny_remaining === 0` on a capped tier, OR because a live
   * POST /can-i just rejected with 402 PENNY_LIMIT_REACHED (see
   * `markPennyLimitReached` below) — the two sources can disagree for a
   * moment (the 402 is always the freshest truth, `info` only catches up on
   * the next refresh), so this is its own field rather than derived fresh
   * from `info` on every read. */
  capped: boolean;
  /** ISO date (YYYY-MM-DD) the allowance next resets, from whichever of the
   * two sources above last set `capped`. Null only when nothing has ever
   * reported one. */
  resetsOn: string | null;
};

let usage: PennyUsage = { info: null, capped: false, resetsOn: null };
const usageListeners = new Set<() => void>();
function notifyUsage() {
  usageListeners.forEach((l) => l());
}
function subscribeUsage(listener: () => void): () => void {
  usageListeners.add(listener);
  return () => { usageListeners.delete(listener); };
}
function getUsageSnapshot(): PennyUsage {
  return usage;
}

/** Fetches GET /subscription and republishes the result to every
 * usePennyUsage() subscriber. Fire-and-forget by design (every call site —
 * PennySheet.tsx on open, PennyConversation.tsx after a model-answered
 * message — treats this as decorative, same as the existing
 * canISuggestions() convention elsewhere in this feature); a failure just
 * leaves the previous snapshot in place rather than surfacing an error the
 * ring/composer have no good way to show anyway. Always trusts a SUCCESSFUL
 * response over any earlier `markPennyLimitReached` call, including
 * clearing `capped` back to false when the fresh figures say the user is no
 * longer at the limit (a top-up, a tier change, or simply next month's
 * reset having already happened). */
export function refreshPennyUsage(): Promise<void> {
  return api.getSubscription()
    .then((info) => {
      const limit = info.usage?.penny_limit;
      const remaining = info.usage?.penny_remaining;
      usage = {
        info,
        capped: limit != null && remaining === 0,
        resetsOn: info.usage?.penny_resets_on ?? null,
      };
      notifyUsage();
    })
    .catch(() => { /* keep the last known snapshot */ });
}

/** Called from PennyConversation.tsx's `ask()` catch block the moment
 * api.canI() rejects with a PennyLimitError (lib/api.ts) — flips the
 * composer to resting IMMEDIATELY, without waiting on a fresh
 * /subscription round-trip that would just confirm what the 402 already
 * said. `info` is left untouched (whatever the last successful fetch was)
 * since this 402 doesn't carry the full SubscriptionInfo shape, only the
 * four usage fields already on PennyLimitError. */
export function markPennyLimitReached(detail: { used: number; limit: number; resets_on: string; tier: string }): void {
  usage = { info: usage.info, capped: true, resetsOn: detail.resets_on };
  notifyUsage();
}

export function usePennyUsage(): PennyUsage {
  return useSyncExternalStore(subscribeUsage, getUsageSnapshot, getUsageSnapshot);
}

/** "YYYY-MM-DD" -> "1 Oct" (en-GB, day + short month) for the resting
 * composer's placeholder and MoreMessagesSheet's own copy — one formatter so
 * the two surfaces can't drift into different date styles. Falls back to
 * the raw ISO string on an unparseable date rather than throwing, and to
 * "next month" when there's no date at all yet (composer resting before the
 * very first /subscription fetch has resolved). */
export function formatPennyResetDate(iso: string | null): string {
  if (!iso) return "next month";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ── MORE MESSAGES SHEET (2026-09-06) — a small nested overlay opened from
// TWO different components (the header's usage-ring crossfade in
// PennySheet.tsx, and the composer's "Get more messages" link in
// PennyConversation.tsx), same cross-component-trigger problem `sheetState`
// above exists to solve, so it gets the identical minimal treatment: a
// boolean singleton, not a second Context. Rendered by PennySheet.tsx as an
// overlay ON the existing floating panel (see that file for the exact
// markup), closed by its own header control, a backdrop tap, or either
// trigger re-firing. ──────────────────────────────────────────────────────

let moreMessagesOpen = false;
const moreMessagesListeners = new Set<() => void>();
function notifyMoreMessages() {
  moreMessagesListeners.forEach((l) => l());
}
function subscribeMoreMessages(listener: () => void): () => void {
  moreMessagesListeners.add(listener);
  return () => { moreMessagesListeners.delete(listener); };
}
function getMoreMessagesSnapshot(): boolean {
  return moreMessagesOpen;
}

export function openMoreMessagesSheet(): void {
  moreMessagesOpen = true;
  notifyMoreMessages();
}
export function closeMoreMessagesSheet(): void {
  moreMessagesOpen = false;
  notifyMoreMessages();
}
export function useMoreMessagesSheet(): boolean {
  return useSyncExternalStore(subscribeMoreMessages, getMoreMessagesSnapshot, getMoreMessagesSnapshot);
}

export function PennySheetProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* Exactly one instance app-wide. Rendered here (not by each page)
          so it mounts once, outside #app-shell (see app/layout.tsx), and
          never unmounts for the life of the session. */}
      <PennySheet />
    </>
  );
}
