import { Suspense } from "react";
import SheetAnatomyClient from "./SheetAnatomyClient";

export default function Page() {
  return <Suspense fallback={null}><SheetAnatomyClient /></Suspense>;
}
