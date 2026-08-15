import { Suspense } from "react";
import TransactionsPage from "./TransactionsPage";

export default function Transactions() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]" />}>
      <TransactionsPage />
    </Suspense>
  );
}
