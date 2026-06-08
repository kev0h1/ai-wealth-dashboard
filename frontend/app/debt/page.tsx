import { Suspense } from "react";
import { Viewport } from "next";
import DebtPage from "./DebtPage";

export const viewport: Viewport = { themeColor: "#b91c1c" };

export default function Debt() {
  return (
    <Suspense fallback={<div className="min-h-dvh" style={{ background: "#b91c1c" }} />}>
      <DebtPage />
    </Suspense>
  );
}
