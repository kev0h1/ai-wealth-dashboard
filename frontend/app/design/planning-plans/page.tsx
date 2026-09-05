import { Suspense } from "react";
import PlanningPlansClient from "./PlanningPlansClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PlanningPlansClient />
    </Suspense>
  );
}
