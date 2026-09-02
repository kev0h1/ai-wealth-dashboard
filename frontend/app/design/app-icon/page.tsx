import { Suspense } from "react";
import AppIconClient from "./AppIconClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AppIconClient />
    </Suspense>
  );
}
