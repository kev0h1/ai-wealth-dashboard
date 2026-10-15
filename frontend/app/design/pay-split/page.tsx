import { Suspense } from "react";
import PaySplitClient from "./PaySplitClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PaySplitClient />
    </Suspense>
  );
}
