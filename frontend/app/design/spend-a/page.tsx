import { Suspense } from "react";
import SpendAClient from "./SpendAClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SpendAClient />
    </Suspense>
  );
}
