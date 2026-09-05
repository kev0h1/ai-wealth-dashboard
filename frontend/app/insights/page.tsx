"use client";

// The Insights page retired 2026-09-05 (owner decision): the money shape
// moved to /spend/shape, tax and receipts became their own top-level routes
// (/tax, /receipts), and everything else that used to live here (the tip
// list, the hero) is gone — tips now live in category sublines and on the
// transactions page (see DESIGN.md's 2026-09-05 note). This route survives
// only as a redirect for old deep links, notifications, and bookmarks.
//
// next.config.ts carries the same three destinations as static redirects
// for the web build, but those are disabled for the Capacitor mobile export
// (see that file's MOBILE_EXPORT guard), so this client redirect is the
// only mechanism the packaged app has — kept here rather than relying on
// next.config.ts alone. `?tab=tax` is the one distinction next.config's
// path-only matching can't make (it sends every /insights request to
// /spend/shape regardless of query), so this is also where that nuance is
// decided for any request that does reach this component.
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function Redirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const destination = searchParams.get("tab") === "tax" ? "/tax" : "/spend/shape";
    router.replace(destination);
  }, [router, searchParams]);

  return null;
}

export default function InsightsRedirectPage() {
  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]">
      <Suspense fallback={null}>
        <Redirect />
      </Suspense>
    </div>
  );
}
