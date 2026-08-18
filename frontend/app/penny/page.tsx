import { Suspense } from "react";
import PennyPage from "./PennyPage";

export default function Penny() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]" />}>
      <PennyPage />
    </Suspense>
  );
}
