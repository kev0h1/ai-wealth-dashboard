import { Suspense } from "react";
import SpendPeriodRoundClient from "./SpendPeriodRoundClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SpendPeriodRoundClient />
    </Suspense>
  );
}
