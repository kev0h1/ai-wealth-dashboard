import { Suspense } from "react";
import GoalSchedulesClient from "./GoalSchedulesClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <GoalSchedulesClient />
    </Suspense>
  );
}
