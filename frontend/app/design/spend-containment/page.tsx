import { Suspense } from "react";
import SpendContainmentClient from "./SpendContainmentClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SpendContainmentClient />
    </Suspense>
  );
}
