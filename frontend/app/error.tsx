"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ErrorState, { ERROR_PRIMARY_ACTION, ERROR_SECONDARY_ACTION } from "@/components/ErrorState";

// G215: designed route-level error boundary. The thrown error is never shown
// (it can carry upstream text). On Home itself "Back to Home" would loop, so it is
// hidden there and "Try again" becomes the primary action.
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [onHome, setOnHome] = useState(false);
  useEffect(() => { setOnHome(window.location.pathname === "/"); }, []);
  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]">
      <ErrorState
        heading="Something went wrong"
        message={onHome
          ? "That didn’t load properly. Nothing has changed in your accounts. Try again."
          : "That didn’t load properly. Nothing has changed in your accounts. Try again, or head back to Home."}
        actions={
          <>
            {!onHome && <Link href="/" className={ERROR_PRIMARY_ACTION}>Back to Home</Link>}
            <button type="button" onClick={reset} className={onHome ? ERROR_PRIMARY_ACTION : ERROR_SECONDARY_ACTION}>Try again</button>
          </>
        }
      />
    </div>
  );
}
