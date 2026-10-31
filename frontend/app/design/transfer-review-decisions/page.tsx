import { Suspense } from "react";
import TransferReviewDecisionsClient from "./TransferReviewDecisionsClient";

// G382 design round. All transactions and decisions are local fixtures.
export default function Page() {
  return <Suspense fallback={null}><TransferReviewDecisionsClient /></Suspense>;
}
