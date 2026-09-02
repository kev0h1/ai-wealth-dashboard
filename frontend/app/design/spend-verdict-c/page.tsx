import { Suspense } from "react";
import SpendVerdictCClient from "./SpendVerdictCClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SpendVerdictCClient />
    </Suspense>
  );
}
