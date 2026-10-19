import { Suspense } from "react";
import HomeCoveredAnatomyClient from "./HomeCoveredAnatomyClient";

export default function Page() {
  return <Suspense fallback={null}><HomeCoveredAnatomyClient /></Suspense>;
}
