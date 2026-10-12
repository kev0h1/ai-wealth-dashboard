import { Suspense } from "react";
import SpendRailClient from "./SpendRailClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SpendRailClient />
    </Suspense>
  );
}
