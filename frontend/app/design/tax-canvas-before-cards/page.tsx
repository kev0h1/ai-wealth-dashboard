import { Suspense } from "react";
import TaxCanvasBeforeCardsClient from "./TaxCanvasBeforeCardsClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <TaxCanvasBeforeCardsClient />
    </Suspense>
  );
}
