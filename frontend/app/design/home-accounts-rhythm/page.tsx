import { Suspense } from "react";
import HomeAccountsRhythmClient from "./HomeAccountsRhythmClient";

// G282 account names and spacing rhythm. Fixtures only, no live data.
export default function Page() {
  return <Suspense fallback={null}><HomeAccountsRhythmClient /></Suspense>;
}
