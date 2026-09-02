import { Suspense } from "react";
import PlanningClient from "./PlanningClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PlanningClient />
    </Suspense>
  );
}
