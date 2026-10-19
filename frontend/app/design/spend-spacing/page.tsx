import { Suspense } from "react";
import SpendSpacingPreview from "./SpendSpacingPreview";

export default function SpendSpacingPage() {
  return <Suspense fallback={null}><SpendSpacingPreview /></Suspense>;
}
