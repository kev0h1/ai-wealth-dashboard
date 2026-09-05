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
