import type { Metadata } from "next";
import { Suspense } from "react";
import FirstSyncClient from "./FirstSyncClient";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <FirstSyncClient />
    </Suspense>
  );
}
