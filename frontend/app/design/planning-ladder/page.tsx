import { Suspense } from "react";
import PlanningLadderClient from "./PlanningLadderClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PlanningLadderClient />
    </Suspense>
  );
}
