import { Suspense } from "react";
import OfflineAccountClient from "./OfflineAccountClient";

// G233 offline account detail alignment. Fixtures only, no live data.
export default function Page() {
  return <Suspense fallback={null}><OfflineAccountClient /></Suspense>;
}
