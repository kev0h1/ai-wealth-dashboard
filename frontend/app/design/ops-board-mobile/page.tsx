import { Suspense } from "react";
import OpsBoardMobileClient from "./OpsBoardMobileClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <OpsBoardMobileClient />
    </Suspense>
  );
}
