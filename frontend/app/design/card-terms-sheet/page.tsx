import { Suspense } from "react";
import CardTermsSheetClient from "./CardTermsSheetClient";

// Seeds the app's own `wd_hide_balances` key before PreferencesProvider mounts
// (same pattern as g134-home-inventory), so the real sheet shows the fixture
// amounts instead of the signed-out default of hidden.
const SEED_SCRIPT = `try{localStorage.setItem('wd_hide_balances','0');}catch(e){}`;

export default function Page() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SEED_SCRIPT }} />
      <Suspense fallback={null}><CardTermsSheetClient /></Suspense>
    </>
  );
}
