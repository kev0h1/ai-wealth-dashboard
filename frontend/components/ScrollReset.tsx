"use client";
import { Suspense, useEffect, useLayoutEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { trackRoute, savedScrollFor, restoreScroll } from "@/lib/scrollRestore";
import { classifyNavigation } from "@/lib/scrollNavDetect";

// Forward navigation (tapping a Link/tab, router.push/replace) starts at the
// top — that's the one Next.js already does for PUSH by default, and the
// behaviour every tab switch in this app relies on. Browser BACK/FORWARD
// (POP) instead restores the scroll position the user left on that route,
// once it has actually rendered enough content to hold it. See
// lib/scrollRestore.ts for why this can't just be the framework's own POP
// handling (it explicitly no-ops and defers to a native one-shot restore
// that fires too early against pages that paint short before their data
// loads — e.g. Spend).
//
// PUSH-vs-POP detection deliberately does NOT use a `popstate` listener +
// ref flag. Next's own internal `popstate` listener (app-router.js) can run
// before ours in the same event dispatch and synchronously flush the
// resulting React state update — including this component's own
// pathname-change effect — before our listener's callback ever executes,
// so the flag isn't set yet when it's read (verified directly: the
// pathname effect observably ran ~5ms before our own `popstate` callback
// fired).
//
// It also deliberately does NOT use `window.history.length` (the previous
// approach here, G108): length never shrinks on a real back — traversal
// moves the position within the existing stack, it doesn't remove entries —
// and a push performed AFTER a back truncates whatever was ahead and
// appends exactly one entry, so the count nets out unchanged too. Both
// cases read as "length didn't grow," which the old code took to mean POP.
// That's exactly backwards for the second case: tap a nav icon right after
// going back once, and it misreads the fresh push as a traversal and
// restores wherever the user had scrolled to on that route last time,
// dropping them at the bottom instead of the top they expect (Kevin's
// report: "whenever I click on a nav icon it goes to the end of the page").
// It also degrades permanently once a tab's real history length hits the
// browser's cap, at which point it stops growing at all. See
// lib/scrollNavDetect.ts for the replacement (a stamp on `history.state`
// whose mere presence — not a length or index comparison — is read
// straight off Next.js's own push-vs-traverse contract) and
// scripts/scroll-nav-detect.test.mjs for a test that fails against this
// old length-based algorithm and passes against the new one.
function ScrollResetInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const navSeq = useRef(0);

  // Take manual control of scroll restoration once, up front, so the
  // browser's native one-shot POP restore never fights the gated restore
  // below (it would otherwise land first, at whatever height existed the
  // instant history traversal happened).
  useEffect(() => {
    if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  // Claims the new route's storage key as early as physically possible —
  // synchronously, right after the DOM commits and strictly before the
  // browser gets a chance to paint. This matters: swapping in the new
  // page's (shorter, not-yet-laid-out) content can make the browser
  // auto-clamp the still-scrolled viewport back down, which dispatches a
  // *genuine* native `scroll` event. That event is asynchronous (queued for
  // the next frame), so it always arrives after a layout effect but can
  // arrive before a plain `useEffect` — if the key hadn't already flipped
  // to the new route by then, the clamp's `0` would land in the *outgoing*
  // route's slot via the continuous listener below, clobbering the real
  // position we needed to keep for its own eventual restore. Observed this
  // exact corruption while building it (persist-to-old-key racing the
  // route-change effect) — hence useLayoutEffect specifically, not useEffect.
  useLayoutEffect(() => {
    trackRoute(pathname, search);
  }, [pathname, search]);

  useEffect(() => {
    // Read AFTER Next's own HistoryUpdater has already run for this
    // navigation (its useInsertionEffect commits strictly before this
    // passive effect, on every render, for every component), so
    // window.history.state reflects the finished push/replace/traverse,
    // not an in-between state.
    const { isPop, stampedState } = classifyNavigation(window.history.state, navSeq.current + 1);
    if (isPop) {
      const saved = savedScrollFor(pathname, search);
      if (saved != null) {
        restoreScroll(saved);
        return;
      }
    } else {
      navSeq.current += 1;
      // Not a real navigation of the URL (no `url` argument) — just stamps
      // the current entry's state so a future traversal back to it is
      // recognised. Goes through Next's patched `history.replaceState`
      // (app-router.js), which merges Next's own __NA/
      // __PRIVATE_NEXTJS_INTERNALS_TREE fields back in, so this can't
      // corrupt the router's own state.
      window.history.replaceState(stampedState, "");
    }
    // Covers real forward navigation, the initial page load, and the rare
    // case of a POP landing on a route with nothing saved for it yet — all
    // of which should start at the top, matching Next's own PUSH default.
    window.scrollTo(0, 0);
  }, [pathname, search]);

  return null;
}

export default function ScrollReset() {
  return (
    <Suspense fallback={null}>
      <ScrollResetInner />
    </Suspense>
  );
}
