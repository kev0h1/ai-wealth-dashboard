import { Suspense } from "react";
import CoverPlanSafeguardsClient from "./CoverPlanSafeguardsClient";

export default function Page() {
  return (
    <Suspense>
      <CoverPlanSafeguardsClient />
    </Suspense>
  );
}
