"use client";

import Link from "next/link";
import ErrorState, { ERROR_PRIMARY_ACTION, ERROR_SECONDARY_ACTION } from "@/components/ErrorState";

// G215: designed route-level error boundary. The thrown error is never shown
// (it can carry upstream text); the digest is Next's own opaque id for support.
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]">
      <ErrorState
        heading="Something went wrong"
        message="That didn’t load properly. Nothing has changed in your accounts. Try again, or head back to Home."
        actions={
          <>
            <Link href="/" className={ERROR_PRIMARY_ACTION}>Back to Home</Link>
            <button type="button" onClick={reset} className={ERROR_SECONDARY_ACTION}>Try again</button>
          </>
        }
      />
    </div>
  );
}
