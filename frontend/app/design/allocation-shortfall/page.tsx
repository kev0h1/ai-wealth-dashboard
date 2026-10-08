import { Suspense } from "react";
import AllocationShortfallClient from "./AllocationShortfallClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AllocationShortfallClient />
    </Suspense>
  );
}
