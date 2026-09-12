import { Suspense } from "react";
import CoverPlanSourcesClient from "./CoverPlanSourcesClient";

export default function Page() {
  return (
    <Suspense>
      <CoverPlanSourcesClient />
    </Suspense>
  );
}
