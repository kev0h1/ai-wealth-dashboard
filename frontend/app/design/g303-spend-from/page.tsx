import type { Metadata } from "next";
import { Suspense } from "react";
import G303Client from "./G303Client";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// Seeds the balances preference before PreferencesProvider mounts so the
// production SafeToSpendCard shows its figure on this signed-out route.
const SEED_BALANCES_SCRIPT = `try{localStorage.setItem('wd_hide_balances','0');}catch(e){}`;

export default function Page() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SEED_BALANCES_SCRIPT }} />
      <Suspense fallback={null}>
        <G303Client />
      </Suspense>
    </>
  );
}
