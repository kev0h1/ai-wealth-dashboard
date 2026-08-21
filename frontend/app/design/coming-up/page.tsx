import { Suspense } from "react";
import ComingUpClient from "./ComingUpClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ComingUpClient />
    </Suspense>
  );
}
