import { Suspense } from "react";
import SpendVerdictAClient from "./SpendVerdictAClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SpendVerdictAClient />
    </Suspense>
  );
}
