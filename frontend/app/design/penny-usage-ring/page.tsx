// TEMPORARY PREVIEW — delete after design review.
import { Suspense } from "react";
import PennyUsageRingClient from "./PennyUsageRingClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PennyUsageRingClient />
    </Suspense>
  );
}
