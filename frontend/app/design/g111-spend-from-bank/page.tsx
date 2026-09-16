import { Suspense } from "react";
import SpendFromBankVariantsClient from "./SpendFromBankVariantsClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SpendFromBankVariantsClient />
    </Suspense>
  );
}
