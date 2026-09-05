import { Suspense } from "react";
import UpcomingPage from "../planning/PlanningPage";

export default function Upcoming() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]" />}>
      <UpcomingPage />
    </Suspense>
  );
}
