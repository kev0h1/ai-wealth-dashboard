import { Suspense } from "react";
import OAuthConsentClient from "./OAuthConsentClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]" />}>
      <OAuthConsentClient />
    </Suspense>
  );
}
