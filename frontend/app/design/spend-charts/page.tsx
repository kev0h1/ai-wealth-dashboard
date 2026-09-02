import { Suspense } from "react";
import SpendChartsClient from "./SpendChartsClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SpendChartsClient />
    </Suspense>
  );
}
