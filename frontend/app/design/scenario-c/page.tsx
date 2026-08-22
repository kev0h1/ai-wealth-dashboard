// TEMPORARY PREVIEW — delete after design review.
import { Suspense } from "react";
import ScenarioCClient from "./ScenarioCClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ScenarioCClient />
    </Suspense>
  );
}
