import { Suspense } from "react";
import SpendLiveClient from "./SpendLiveClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SpendLiveClient />
    </Suspense>
  );
}
