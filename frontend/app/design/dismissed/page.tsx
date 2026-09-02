// Thin server component per the /design/* convention (see
// /design/month-story/page.tsx): no data fetching, no imports from
// AccountMiniCard.tsx (BankBadge/BANK_META/bankKey are client-only exports
// and importing them here would break the production build). All real
// work happens in DismissedClient.tsx.

import DismissedClient from "./DismissedClient";

export default function Page() {
  return <DismissedClient />;
}
