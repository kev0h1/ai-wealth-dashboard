import { Suspense } from "react";
import SpendPage from "../components/SpendPage";

export default function Spend() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#f0f2f7]" />}>
      <SpendPage />
    </Suspense>
  );
}
