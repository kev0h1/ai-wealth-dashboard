import { Suspense } from "react";
import SpendPageRefurbishmentClient from "./SpendPageRefurbishmentClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SpendPageRefurbishmentClient />
    </Suspense>
  );
}
