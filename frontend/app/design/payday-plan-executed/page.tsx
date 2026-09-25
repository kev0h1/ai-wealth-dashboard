import { Suspense } from "react";
import PaydayPlanExecutedClient from "./PaydayPlanExecutedClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PaydayPlanExecutedClient />
    </Suspense>
  );
}
