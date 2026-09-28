import { Suspense } from "react";
import G115SpendFromAccountsClient from "./G115SpendFromAccountsClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <G115SpendFromAccountsClient />
    </Suspense>
  );
}
