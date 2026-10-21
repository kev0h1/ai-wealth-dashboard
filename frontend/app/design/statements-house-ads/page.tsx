import { Suspense } from "react";
import StatementsHouseAdsClient from "./StatementsHouseAdsClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <StatementsHouseAdsClient />
    </Suspense>
  );
}
