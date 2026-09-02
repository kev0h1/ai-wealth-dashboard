// TEMPORARY PREVIEW — delete after design review.
import { Suspense } from "react";
import InsightsHeroClient from "./InsightsHeroClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <InsightsHeroClient />
    </Suspense>
  );
}
