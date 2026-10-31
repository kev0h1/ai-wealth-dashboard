import { Suspense } from "react";
import PendingPaymentsClient from "./PendingPaymentsClient";

// G373 design round. Static fixtures only: this route deliberately has no
// data request, preference write, or payment mutation.
export default function Page() {
  return <Suspense fallback={null}><PendingPaymentsClient /></Suspense>;
}
