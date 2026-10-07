import { Suspense } from "react";
import PlanDeferralClient from "./PlanDeferralClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PlanDeferralClient />
    </Suspense>
  );
}
