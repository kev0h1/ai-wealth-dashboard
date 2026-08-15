import { Suspense } from "react";
import CardsCheckClient from "./CardsCheckClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CardsCheckClient />
    </Suspense>
  );
}
