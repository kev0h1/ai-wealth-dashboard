import { Suspense } from "react";
import SpendBClient from "./SpendBClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SpendBClient />
    </Suspense>
  );
}
