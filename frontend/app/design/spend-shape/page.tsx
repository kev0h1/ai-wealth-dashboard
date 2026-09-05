import { Suspense } from "react";
import SpendShapeClient from "./SpendShapeClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SpendShapeClient />
    </Suspense>
  );
}
