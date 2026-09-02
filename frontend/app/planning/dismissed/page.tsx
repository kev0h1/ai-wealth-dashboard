// Thin server component per the app's page.tsx convention (see
// /planning/page.tsx, /debt-plan/page.tsx): no data fetching, no imports
// from AccountMiniCard.tsx (BankBadge/BANK_META are client-only exports
// and importing them here would break the production build). All real
// work happens in SetAsideClient.tsx.

import { Suspense } from "react";
import SetAsideClient from "./SetAsideClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]" />}>
      <SetAsideClient />
    </Suspense>
  );
}
