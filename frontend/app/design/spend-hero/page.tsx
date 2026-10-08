import { Suspense } from "react";
import SpendHeroClient from "./SpendHeroClient";

export default function Page() {
  return <Suspense fallback={null}><SpendHeroClient /></Suspense>;
}
