// TEMPORARY PREVIEW — delete after design review.
import { Suspense } from "react";
import ScenarioBClient from "./ScenarioBClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ScenarioBClient />
    </Suspense>
  );
}
