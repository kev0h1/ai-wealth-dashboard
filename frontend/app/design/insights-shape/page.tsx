// TEMPORARY PREVIEW — delete after design review.
import { Suspense } from "react";
import InsightsShapeClient from "./InsightsShapeClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <InsightsShapeClient />
    </Suspense>
  );
}
