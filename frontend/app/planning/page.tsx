import { Suspense } from "react";
import PlanningPage from "./PlanningPage";

export default function Planning() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]" />}>
      <PlanningPage />
    </Suspense>
  );
}
