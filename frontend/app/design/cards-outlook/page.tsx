import { Suspense } from "react";
import CardsOutlookClient from "./CardsOutlookClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CardsOutlookClient />
    </Suspense>
  );
}
