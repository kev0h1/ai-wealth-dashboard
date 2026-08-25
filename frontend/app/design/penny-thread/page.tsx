// TEMPORARY PREVIEW — delete after design review.
import { Suspense } from "react";
import PennyThreadClient from "./PennyThreadClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PennyThreadClient />
    </Suspense>
  );
}
