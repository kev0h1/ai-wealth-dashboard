import { Suspense } from "react";
import PlanningCreateClient from "./PlanningCreateClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PlanningCreateClient />
    </Suspense>
  );
}
