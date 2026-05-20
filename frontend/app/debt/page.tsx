import { Suspense } from "react";
import DebtPage from "./DebtPage";

export default function Debt() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#f0f2f7]" />}>
      <DebtPage />
    </Suspense>
  );
}
