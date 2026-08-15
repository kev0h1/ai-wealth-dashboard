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
const RESTORE_TIMEOUT_MS = 2000;

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

function persistCurrentScroll() {
  if (!currentKey) return;
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
  console.debug("[scrollRestore] restoreScroll called targetY=" + targetY + " startY=" + startY);
  if (Math.abs(startY - targetY) < 2) return; // already there

  const viewportHeight = window.innerHeight;
  const deadline = Date.now() + RESTORE_TIMEOUT_MS;
  let done = false;

  const onUserScroll = () => {
    if (done) return;
    console.debug("[scrollRestore] onUserScroll fired, abandoning. scrollY=" + window.scrollY);
    done = true;
    window.removeEventListener("scroll", onUserScroll);
  };
  window.addEventListener("scroll", onUserScroll, { passive: true });

  function finish(y: number) {
    if (done) return;
    done = true;
    window.removeEventListener("scroll", onUserScroll);
    window.scrollTo(0, y);
    console.debug("[scrollRestore] finish y=" + y + " postScrollY=" + window.scrollY);
  }

  function tick() {
    if (done) return;
    const tallEnough = document.documentElement.scrollHeight >= targetY + viewportHeight;
    if (tallEnough) {
      finish(targetY);
      return;
    }
    if (Date.now() >= deadline) {
      const maxY = Math.max(0, document.documentElement.scrollHeight - viewportHeight);
      finish(Math.min(targetY, maxY));
      return;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
