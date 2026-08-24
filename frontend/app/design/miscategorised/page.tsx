import { Suspense } from "react";
import MiscategorisedClient from "./MiscategorisedClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MiscategorisedClient />
    </Suspense>
  );
}
