import { Suspense } from "react";
import AccountRowsClient from "./AccountRowsClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AccountRowsClient />
    </Suspense>
  );
}
