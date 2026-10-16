import { Suspense } from "react";
import PaySplitCompareClient from "./PaySplitCompareClient";

export default function PaySplitComparePage() {
  return <Suspense fallback={<main className="min-h-screen bg-slate-100 dark:bg-slate-950" />}><PaySplitCompareClient /></Suspense>;
}
