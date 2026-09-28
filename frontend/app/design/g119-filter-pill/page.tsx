import { Suspense } from "react";
import FilterPillClient from "./FilterPillClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <FilterPillClient />
    </Suspense>
  );
}
