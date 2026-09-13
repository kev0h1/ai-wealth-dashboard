import { Suspense } from "react";
import HomeBriefCardsClient from "./HomeBriefCardsClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <HomeBriefCardsClient />
    </Suspense>
  );
}
