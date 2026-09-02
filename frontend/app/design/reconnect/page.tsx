// TEMPORARY PREVIEW — delete with the other /design/* routes
//
// Thin server wrapper around ReconnectClient.tsx. bankKey/BANK_META/
// BankBadge (frontend/components/AccountMiniCard.tsx) are exported from a
// "use client" module, so a server component can't call them at prerender
// time (matches the split /design/month-story uses: page.tsx here stays a
// server component, everything that touches those client exports lives in
// the sibling client component). No data fetching, no auth — /design/* is
// exempt (see components/AuthProvider.tsx). Deep-linkable at
// /design/reconnect.

import ReconnectClient from "./ReconnectClient";

export default function Page() {
  return <ReconnectClient />;
}
