import { Suspense } from "react";
import SafeToSpendHeroClient from "./SafeToSpendHeroClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SafeToSpendHeroClient />
    </Suspense>
  );
}
