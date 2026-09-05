import { Suspense } from "react";
import UpcomingPlanClient from "./UpcomingPlanClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <UpcomingPlanClient />
    </Suspense>
  );
}
