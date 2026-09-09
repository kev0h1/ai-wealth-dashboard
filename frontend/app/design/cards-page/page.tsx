import { Suspense } from "react";
import CardsPageVariantsClient from "./CardsPageVariantsClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CardsPageVariantsClient />
    </Suspense>
  );
}
