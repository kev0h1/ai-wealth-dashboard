import type { Metadata } from "next";
import { Suspense } from "react";
import SyncLoadingClient from "./SyncLoadingClient";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// Seeds the balances preference before PreferencesProvider mounts so the
// production SafeToSpendCard shows its figure on this signed-out route (the
// same trap and fix as /design/g134-home-inventory).
const SEED_BALANCES_SCRIPT = `try{localStorage.setItem('wd_hide_balances','0');}catch(e){}`;

export default function Page() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SEED_BALANCES_SCRIPT }} />
      <Suspense fallback={null}>
        <SyncLoadingClient />
      </Suspense>
    </>
  );
}
