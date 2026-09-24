import { Suspense } from "react";
import G119Client from "./G119Client";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <G119Client />
    </Suspense>
  );
}
