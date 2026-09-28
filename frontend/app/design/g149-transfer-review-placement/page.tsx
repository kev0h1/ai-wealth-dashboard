import { Suspense } from "react";
import G149TransferReviewPlacementClient from "./G149TransferReviewPlacementClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <G149TransferReviewPlacementClient />
    </Suspense>
  );
}
