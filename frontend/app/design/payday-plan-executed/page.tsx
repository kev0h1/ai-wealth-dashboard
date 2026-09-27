import { Suspense } from "react";
import PaydayPlanLifecycleClient from "./PaydayPlanLifecycleClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PaydayPlanLifecycleClient />
    </Suspense>
  );
}
