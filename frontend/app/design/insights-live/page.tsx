import { Suspense } from "react";
import InsightsLiveClient from "./InsightsLiveClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <InsightsLiveClient />
    </Suspense>
  );
}
