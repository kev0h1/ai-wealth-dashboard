"use client";

// G215: the designed Next error surfaces. not-found and error render the production
// components/ErrorState with the same copy as app/not-found.tsx and app/error.tsx (fixture
// props, inert actions); notice renders the production ConfirmSheetView (the alert()
// replacement). app/global-error.tsx replaces the whole <html> document, so it cannot be
// embedded in a page; it reuses ErrorState's anatomy and tokens and was checked as static
// HTML in headless Chrome. ?state=not-found|error|notice&mode=light|dark
import { useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ErrorState, { ERROR_PRIMARY_ACTION, ERROR_SECONDARY_ACTION } from "@/components/ErrorState";
import { ConfirmSheetView } from "@/components/ConfirmSheet";

export default function ErrorStatesClient() {
  const params = useSearchParams();
  const kind = params.get("state") === "error" ? "error" : params.get("state") === "notice" ? "notice" : "not-found";
  const dark = params.get("mode") === "dark";

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      if (root.classList.contains("dark") !== dark) root.classList.toggle("dark", dark);
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", dark ? "dark" : "light");
    return () => obs.disconnect();
  }, [dark]);

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]">
      {kind === "not-found" && (
        <ErrorState
          heading="That page isn’t here"
          message="The link may be old or mistyped. Your money is exactly where you left it."
          actions={<Link href="/design/error-states" className={ERROR_PRIMARY_ACTION}>Back to Home</Link>}
        />
      )}
      {kind === "error" && (
        <ErrorState
          heading="Something went wrong"
          message="That didn’t load properly. Nothing has changed in your accounts. Try again, or head back to Home."
          actions={
            <>
              <Link href="/design/error-states?state=error" className={ERROR_PRIMARY_ACTION}>Back to Home</Link>
              <button type="button" className={ERROR_SECONDARY_ACTION}>Try again</button>
            </>
          }
        />
      )}
      {kind === "notice" && (
        <ConfirmSheetView
          title="Couldn’t start reconnection"
          body="Please try again."
          confirmLabel="OK"
          cancelLabel={null}
          manageHistory={false}
          onResult={() => {}}
        />
      )}
    </div>
  );
}
