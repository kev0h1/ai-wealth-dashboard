import { Suspense } from "react";
import SetAsideClient from "../../planning/dismissed/SetAsideClient";

export default function UpcomingDismissed() {
  return (
    <Suspense fallback={null}>
      <SetAsideClient />
    </Suspense>
  );
}
