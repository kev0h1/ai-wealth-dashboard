import { Suspense } from "react";
import SpendHeroScaleClient from "./SpendHeroScaleClient";

export default function Page() {
  return <Suspense fallback={null}><SpendHeroScaleClient /></Suspense>;
}
