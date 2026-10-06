import { Suspense } from "react";
import HomeCleanupClient from "./HomeCleanupClient";

// G221 Home clean-up round. Fixtures only, no live data.
export default function Page() {
  return <Suspense fallback={null}><HomeCleanupClient /></Suspense>;
}
