import { Suspense } from "react";
import SpendVerdictBClient from "./SpendVerdictBClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SpendVerdictBClient />
    </Suspense>
  );
}
