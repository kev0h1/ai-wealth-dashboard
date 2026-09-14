import { Suspense } from "react";
import SpendHeaderRulesClient from "./SpendHeaderRulesClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SpendHeaderRulesClient />
    </Suspense>
  );
}
