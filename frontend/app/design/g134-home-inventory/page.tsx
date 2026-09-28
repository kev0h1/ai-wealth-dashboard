import { Suspense } from "react";
import HomeInventoryClient from "./HomeInventoryClient";

// G134 — Home surface inventory catalogue. Fixtures only, no live data.
// A pre-hydration script (matching the app's own dark-mode pre-paint
// pattern in app/layout.tsx) seeds localStorage's `wd_hide_balances` key
// from the `balances` URL param BEFORE PreferencesContext's PreferencesProvider
// mounts. SafeToSpendCard reads hideNetWorth from that global context, not
// from a prop, so without this the fail-closed default (hidden until the
// (always-401-on-this-unauthenticated-preview) preferences fetch resolves)
// would mask every figure on first load regardless of what this preview
// wants to demonstrate. Setting it here, before React hydrates, means the
// context's own first render already reads the value this preview asked
// for — no flash, no optimistic-then-reverted flicker from calling the real
// setHideNetWorth() setter after mount (which would round-trip through a
// PATCH /preferences that also fails on this unauthenticated route).
const SEED_BALANCES_SCRIPT = `try{var p=new URLSearchParams(location.search);var hidden=p.get('balances')==='hidden';localStorage.setItem('wd_hide_balances', hidden ? '1' : '0');}catch(e){}`;

export default function Page() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SEED_BALANCES_SCRIPT }} />
      <Suspense fallback={null}>
        <HomeInventoryClient />
      </Suspense>
    </>
  );
}
