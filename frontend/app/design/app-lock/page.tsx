import { Suspense } from "react";
import AppLockClient from "./AppLockClient";

export default function Page() {
  return (
    <Suspense>
      <AppLockClient />
    </Suspense>
  );
}
