import { Suspense } from "react";
import ReelSafeToSpendClient from "./ReelSafeToSpendClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ReelSafeToSpendClient />
    </Suspense>
  );
}
