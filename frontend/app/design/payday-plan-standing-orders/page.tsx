import { Suspense } from "react";
import PaydayPlanStandingOrdersClient from "./PaydayPlanStandingOrdersClient";

export default function Page() {
  return (
    <Suspense>
      <PaydayPlanStandingOrdersClient />
    </Suspense>
  );
}
