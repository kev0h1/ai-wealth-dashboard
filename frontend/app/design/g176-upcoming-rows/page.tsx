import { Suspense } from "react";
import G176Client from "./G176Client";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <G176Client />
    </Suspense>
  );
}
