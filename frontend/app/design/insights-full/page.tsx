// TEMPORARY PREVIEW — delete after design review.
import { Suspense } from "react";
import InsightsFullClient from "./InsightsFullClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <InsightsFullClient />
    </Suspense>
  );
}
