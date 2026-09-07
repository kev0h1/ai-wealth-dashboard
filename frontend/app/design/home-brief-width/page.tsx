// Thin server component per the /design/* convention (see
// /design/dismissed/page.tsx, /design/reconnect/page.tsx): no data
// fetching, no auth (/design/* is exempt — see components/AuthProvider.tsx).
// All real work happens in HomeBriefWidthClient.tsx, which needs
// useRouter (client-only).

import HomeBriefWidthClient from "./HomeBriefWidthClient";

export default function Page() {
  return <HomeBriefWidthClient />;
}
