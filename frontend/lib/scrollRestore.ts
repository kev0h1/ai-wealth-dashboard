// Shared route-scroll memory + POP-aware, height-gated restoration.
//
// Why this exists (see ScrollReset.tsx for the consumer): the App Router's
// own scroll handling (node_modules/next/dist/client/components/
// router-reducer/reducers/restore-reducer.js) explicitly sets `scrollRef:
// null` on history traversal (browser BACK/FORWARD) — it deliberately does
// NOT force a scroll position on POP, deferring to the browser's native
// `history.scrollRestoration`. That native restore fires once, synchronously
// with the pop, and never retries. On a page that paints short-then-tall
// while its data streams in (e.g. Spend, which starts at `loading = true`
// with no cached verdict), the one-shot native restore lands wrong and stays
// wrong. There is no App Router equivalent of the old `experimental.
// scrollRestoration` flag — that option (server/config-shared.js) only wires
// up `shared/lib/router/router.js`, the Pages Router. So there's no
// framework knob to flip here; this hand-rolls exactly what that legacy flag
// used to do (`window.history.scrollRestoration = 'manual'` + save/restore
// via storage), adapted to wait for content height before restoring.

const KEY_PREFIX = "wd_scroll:";
// Bug round 3 (owner report, 2026-08-31 — /spend "Money you moved" ->
// /transactions -> BACK still landing at the top): reproduced with a real,
// CDP-driven round trip (headless Chrome, mobile viewport, real
// pushState/history-traversal navigation) at
// frontend/app/design/spend-restore-check/ against the real SpendHeader +
// SpendVerdictView components. A round trip fast enough for the revisit's
// data to already be warm (in-memory verdict cache, <1s) restored correctly
// every time; forcing the revisit's fetch to be genuinely slow (>2s — the
// realistic case on a phone: cellular data, a cold Railway container, or
// the module-level cache having gone cold, e.g. the WebView was discarded
// while backgrounded) reproduced the bug exactly: the page was still short
// (no verdict painted, scrollHeight ~844) when this poll's old 2000ms
// deadline hit, so `finish()` clamped to whatever the short page allowed —
// 0 — and considered itself DONE. When the real content landed a second
// later and the page grew to its true height, nothing was left watching for
// that growth, so the clamped 0 stuck permanently even though the page was
// now tall enough to hold the real target. Measured before/after with the
// harness: at the old 2000ms deadline the doc was still 844px tall
// (verdict hadn't painted); the verdict actually landed around 4000ms and
// the doc reached its full 2077px around 5000ms — a full ~3s past the old
// deadline. 15000ms comfortably covers that gap (and much worse mobile
// conditions) while still giving up eventually rather than polling forever.
// This does not reintroduce visible crawling: intermediate polls never call
// scrollTo, only the final `finish()` does — still a single jump, just one
// that now waits for the real content instead of a fixed sleep.
const RESTORE_TIMEOUT_MS = 15000;

function routeKey(pathname: string, search: string): string {
  return `${KEY_PREFIX}${pathname}${search ? `?${search}` : ""}`;
}

function readSaved(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeSaved(key: string, y: number) {
  try {
    sessionStorage.setItem(key, String(Math.round(y)));
  } catch {
    // sessionStorage unavailable (private mode etc.) — restoration simply
    // won't happen; scroll-to-top on every route stays the safe fallback.
  }
}

let currentKey = "";
let listenerAttached = false;
let rafPending = false;
// True for the duration of an in-flight restoreScroll() call. A route that
// paints short-then-tall (e.g. Insights) gets auto-clamped by the browser
// when the shorter content lands, which dispatches a genuine async `scroll`
// event indistinguishable, to the continuous persist listener below, from
// the user actually scrolling. Without this guard that clamp's near-zero
// position gets written into the *new* route's just-claimed storage slot
// (trackRoute's layout effect already flipped currentKey by the time the
// clamp event fires), permanently destroying the saved position for every
// future back-navigation to it. Suppressing persistence while a restore is
// in flight keeps the clamp from ever being mistaken for a real position.
let restoreInFlight = false;

function persistCurrentScroll() {
  if (!currentKey || restoreInFlight) return;
  writeSaved(currentKey, window.scrollY);
}

function ensureListener() {
  if (listenerAttached || typeof window === "undefined") return;
  listenerAttached = true;
  // rAF-throttled: cheap continuous tracking of "where the user is" per
  // route, so whichever link they eventually tap, the departing page's
  // position is already correct — no per-call-site instrumentation needed.
  window.addEventListener(
    "scroll",
    () => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        persistCurrentScroll();
      });
    },
    { passive: true }
  );
}

/** Call on every route change (pathname+search). Starts tracking scroll for
 *  the new route under its own key; the route being left keeps whatever the
 *  scroll listener last wrote for it. */
export function trackRoute(pathname: string, search: string) {
  ensureListener();
  currentKey = routeKey(pathname, search);
}

export function savedScrollFor(pathname: string, search: string): number | null {
  return readSaved(routeKey(pathname, search));
}

/** Restore scroll on the current route to `targetY`, but only once the page
 *  has grown tall enough to actually hold that position — otherwise a
 *  still-loading page (short) would clamp the restore to its bottom instead.
 *  Polls via rAF up to RESTORE_TIMEOUT_MS, then best-effort restores as far
 *  as the page currently allows. If the user scrolls manually at any point
 *  before it settles, the restore is abandoned outright — never yanks them. */
export function restoreScroll(targetY: number) {
  if (typeof window === "undefined" || targetY <= 0) return;

  const startY = window.scrollY;
  if (Math.abs(startY - targetY) < 2) return; // already there

  const viewportHeight = window.innerHeight;
  const deadline = Date.now() + RESTORE_TIMEOUT_MS;
  let done = false;
  // Position `finish` last applied via window.scrollTo, if any — belt-and-
  // braces against a stray scroll event reporting exactly that value (see
  // isExplainedByClamp below).
  let lastSetY: number | null = null;
  restoreInFlight = true;

  function currentMaxScroll(): number {
    return Math.max(0, document.documentElement.scrollHeight - viewportHeight);
  }

  // A scroll event during restore can mean two very different things: the
  // user actually scrolling (abandon, never yank them), or the browser
  // auto-clamping the still-scrolled viewport down because the newly-routed
  // page painted shorter than where they were (ignore it and keep polling —
  // that's exactly the height-gated wait this function exists to do). The
  // two are distinguished by whether the reported position is one the clamp
  // could have produced: the document must still be too short to hold
  // targetY, and the position must sit at (or past) the document's current
  // max scroll, within a small tolerance for sub-pixel rounding.
  function isExplainedByClamp(y: number): boolean {
    const tallEnough = document.documentElement.scrollHeight >= targetY + viewportHeight;
    if (tallEnough) return false;
    const maxY = currentMaxScroll();
    if (Math.abs(y - maxY) <= 2) return true;
    if (lastSetY != null && Math.abs(y - lastSetY) <= 2) return true;
    return false;
  }

  const onUserScroll = () => {
    if (done) return;
    if (isExplainedByClamp(window.scrollY)) return;
    done = true;
    restoreInFlight = false;
    window.removeEventListener("scroll", onUserScroll);
  };
  window.addEventListener("scroll", onUserScroll, { passive: true });

  function finish(y: number) {
    if (done) return;
    done = true;
    restoreInFlight = false;
    window.removeEventListener("scroll", onUserScroll);
    lastSetY = y;
    window.scrollTo(0, y);
  }

  function tick() {
    if (done) return;
    const tallEnough = document.documentElement.scrollHeight >= targetY + viewportHeight;
    if (tallEnough) {
      finish(targetY);
      return;
    }
    if (Date.now() >= deadline) {
      finish(Math.min(targetY, currentMaxScroll()));
      return;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
