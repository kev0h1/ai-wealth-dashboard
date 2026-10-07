import { Suspense } from "react";
import StsAccountsRouteClient from "./StsAccountsRouteClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <StsAccountsRouteClient />
    </Suspense>
  );
}
