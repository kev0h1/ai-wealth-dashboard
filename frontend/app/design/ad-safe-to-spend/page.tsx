import { Suspense } from "react";
import AdSafeToSpendClient from "./AdSafeToSpendClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AdSafeToSpendClient />
    </Suspense>
  );
}
