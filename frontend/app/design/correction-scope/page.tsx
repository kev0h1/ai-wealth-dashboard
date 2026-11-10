import { Suspense } from "react";
import CorrectionScopeClient from "./CorrectionScopeClient";

export default function Page() {
  return <Suspense fallback={null}><CorrectionScopeClient /></Suspense>;
}
