import { Suspense } from "react";
import CashLedEngineClient from "./CashLedEngineClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CashLedEngineClient />
    </Suspense>
  );
}
