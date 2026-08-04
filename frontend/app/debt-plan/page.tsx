import { Suspense } from "react";
import DebtPlanPage from "./DebtPlanPage";

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]" />}>
      <DebtPlanPage />
    </Suspense>
  );
}
