import { Suspense } from "react";
import { Viewport } from "next";
import BudgetPage from "./BudgetPage";

export const viewport: Viewport = { themeColor: "#059669" };

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-dvh" style={{ background: "linear-gradient(135deg,#059669 0%,#047857 100%)" }} />}>
      <BudgetPage />
    </Suspense>
  );
}
