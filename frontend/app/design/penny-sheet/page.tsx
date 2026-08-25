// TEMPORARY PREVIEW — delete after design review.
import { Suspense } from "react";
import PennySheetClient from "./PennySheetClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PennySheetClient />
    </Suspense>
  );
}
