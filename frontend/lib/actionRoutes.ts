// G284: the one place a server-supplied action route (companion.py, grow.py,
// persisted companion documents) becomes an in-app destination.
//
// Rules the native shells impose, and why every action component goes through
// here and through Next's router or <Link> (never a raw <a href> or
// window.location for an in-app path):
//   1. The Capacitor apps serve the static export. A full navigation to
//      "/tax" is answered with index.html (the shell falls back to it for any
//      extensionless path), so the app reloads Home instead of the target. Only
//      a client-side navigation (router.push / Link) resolves the route.
//   2. next.config.ts redirects() is disabled for the export, so routes the web
//      build redirects (retired pages) have no page at all in the app. The
//      retired routes are rewritten here to their successors instead.
const RETIRED_ROUTES: Record<string, string> = {
  "/debt-plan": "/cards",
  "/debt": "/cards",
  "/budget": "/spend",
  "/insights/tax": "/tax",
  "/insights/receipts": "/receipts",
  "/grow": "/planning",
};

/** Same-origin, retired-route-aware destination for a server action route.
 *  Anything that is not a plain absolute in-app path falls back. */
export function actionHref(route: string | null | undefined, fallback = "/upcoming"): string {
  // A backslash is read as "/" by browsers, so "/\\evil" could become "//evil".
  if (typeof route !== "string" || !route.startsWith("/") || route.startsWith("//") || route.includes("\\")) return fallback;
  const match = /^([^?#]*)(.*)$/.exec(route);
  const path = (match?.[1] ?? route).replace(/(.)\/+$/, "$1");
  const rest = match?.[2] ?? "";
  // The web redirect for /insights: ?tab=tax goes to /tax, everything else to the money shape.
  if (path === "/insights") return new URLSearchParams(rest.replace(/^\?/, "").split("#")[0]).get("tab") === "tax" ? "/tax" : "/spend/shape";
  return (RETIRED_ROUTES[path] ?? path) + rest;
}
