import { Suspense } from "react";
import BankCoverageClient from "./BankCoverageClient";

export default function BankCoveragePage() {
  return <Suspense fallback={<p className="p-6 text-sm">Loading bank coverage preview…</p>}><BankCoverageClient /></Suspense>;
}
