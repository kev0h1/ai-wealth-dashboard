import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// A110: production has two ingress paths in front of the backend with
// different trusted X-Forwarded-For hop counts (see
// backend/app/core/config.py's TRUSTED_PROXY_HOPS_WEB comment and
// docs/ops/ENV.md). Web traffic goes browser -> Vercel (the /api rewrite
// in next.config.ts) -> Railway edge -> app, two appending hops; the
// mobile apps call the Railway host directly, one hop. A single
// TRUSTED_PROXY_HOPS cannot serve both safely. This proxy tags every
// request this Next.js server forwards to the backend with a shared
// secret header, so the backend can tell "this request really came
// through my own Vercel rewrite" apart from "this request hit Railway
// directly" and pick the right hop count for each, rather than guessing
// from a hop count alone.
//
// Next.js 16.3.4 renamed the middleware file convention to `proxy`
// (middleware.ts still works but is deprecated; see
// frontend/node_modules/next/dist/docs/.../file-conventions/proxy.md),
// hence the file name here.
//
// Only matched to /api/:path*, never the whole app, so it can never
// affect a page render, only the outgoing request next.config.ts's own
// rewrite makes to the backend.
//
// Mobile builds (MOBILE_EXPORT=1, output: 'export' in next.config.ts) do
// not run this file at all: a static export has no server, so there is
// no proxy/middleware step and no /api rewrite for it to tag. That build
// reaches the backend directly (API_PUBLIC_URL), which is exactly the
// "one hop" path this header exists to distinguish FROM, so nothing
// further is needed here for that case.
//
// API_PROXY_SECRET is a server-only env var (never NEXT_PUBLIC_), read
// fresh on each request rather than cached at module load so a Vercel
// env change takes effect without a redeploy. When it is unset (e.g.
// local dev, or before the variable is provisioned on Vercel) this does
// nothing and the request passes through unchanged, same as before this
// file existed.
export function proxy(request: NextRequest) {
  const secret = process.env.API_PROXY_SECRET;
  if (!secret) {
    return NextResponse.next();
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("X-Sorted-Proxy-Auth", secret);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: "/api/:path*",
};
