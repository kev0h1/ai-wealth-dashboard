import { Suspense } from "react";
import CardTermsSheetClient from "./CardTermsSheetClient";

export default function Page() {
  return <Suspense fallback={null}><CardTermsSheetClient /></Suspense>;
}
