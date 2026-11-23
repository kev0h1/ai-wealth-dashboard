import { Suspense } from "react";
import HomeCardLayoutClient from "./HomeCardLayoutClient";

// G490 is a fixture-only presentation round. Query controls live in the client
// layer so the page remains deep-linkable at ?variant=a|b&mode=light|dark.
export default function Page() {
  return <Suspense fallback={null}><HomeCardLayoutClient /></Suspense>;
}
