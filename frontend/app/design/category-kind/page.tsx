import { Suspense } from "react";
import CategoryKindClient from "./CategoryKindClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CategoryKindClient />
    </Suspense>
  );
}
