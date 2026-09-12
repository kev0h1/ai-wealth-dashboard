import { Suspense } from "react";
import CoverPlanSourcesScaleClient from "./CoverPlanSourcesScaleClient";

export default function Page() {
  return (
    <Suspense>
      <CoverPlanSourcesScaleClient />
    </Suspense>
  );
}
