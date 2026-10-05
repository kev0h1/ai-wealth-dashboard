import { Suspense } from "react";
import SafeToSpendFigureClient from "./SafeToSpendFigureClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SafeToSpendFigureClient />
    </Suspense>
  );
}
