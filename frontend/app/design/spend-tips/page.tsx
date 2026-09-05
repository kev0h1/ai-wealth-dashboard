import { Suspense } from "react";
import SpendTipsClient from "./SpendTipsClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SpendTipsClient />
    </Suspense>
  );
}
