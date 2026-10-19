import { Suspense } from "react";
import HomeBriefAnatomyClient from "./HomeBriefAnatomyClient";

export default function Page() {
  return <Suspense fallback={null}><HomeBriefAnatomyClient /></Suspense>;
}
