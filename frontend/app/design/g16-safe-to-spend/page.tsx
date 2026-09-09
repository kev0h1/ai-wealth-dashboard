import { Suspense } from "react";
import G16SafeToSpendClient from "./G16SafeToSpendClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <G16SafeToSpendClient />
    </Suspense>
  );
}
