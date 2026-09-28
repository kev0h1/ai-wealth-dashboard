import { Suspense } from "react";
import G128Client from "./G128Client";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <G128Client />
    </Suspense>
  );
}
