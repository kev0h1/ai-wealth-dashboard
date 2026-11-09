import { Suspense } from "react";
import type { Metadata } from "next";
import IncomeBeforePaydayClient from "./IncomeBeforePaydayClient";

export const metadata: Metadata = {
  title: "Income before payday · G446 design review",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <Suspense fallback={null}><IncomeBeforePaydayClient /></Suspense>;
}
