import { Suspense } from "react";
import McpConsentJourneyClient from "./McpConsentJourneyClient";

export default function Page() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]" />}>
      <McpConsentJourneyClient />
    </Suspense>
  );
}
