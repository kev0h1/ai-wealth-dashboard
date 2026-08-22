// TEMPORARY PREVIEW — delete after design review.
import { Suspense } from "react";
import ScenarioAClient from "./ScenarioAClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ScenarioAClient />
    </Suspense>
  );
}
