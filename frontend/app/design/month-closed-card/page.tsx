import { Suspense } from "react";
import MonthClosedCardClient from "./MonthClosedCardClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MonthClosedCardClient />
    </Suspense>
  );
}
