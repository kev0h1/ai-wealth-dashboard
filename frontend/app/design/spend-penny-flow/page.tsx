// TEMPORARY PREVIEW — delete after design review.
import { Suspense } from "react";
import SpendPennyFlowClient from "./SpendPennyFlowClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SpendPennyFlowClient />
    </Suspense>
  );
}
