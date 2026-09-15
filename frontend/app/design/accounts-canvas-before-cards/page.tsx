import { Suspense } from "react";
import AccountsCanvasBeforeCardsClient from "./AccountsCanvasBeforeCardsClient";

export default function AccountsCanvasBeforeCardsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-[#f0f2f7] px-4 py-8 text-sm text-slate-600 dark:bg-[#0f172a] dark:text-slate-400">
          Loading Accounts preview…
        </div>
      }
    >
      <AccountsCanvasBeforeCardsClient />
    </Suspense>
  );
}
