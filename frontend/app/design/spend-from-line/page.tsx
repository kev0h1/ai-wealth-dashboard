import type { Metadata } from "next";
import { Suspense } from "react";
import SpendFromLineClient from "./SpendFromLineClient";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export default function SpendFromLinePage() {
  return <Suspense fallback={<p className="p-6 text-sm">Loading the layout examples…</p>}><SpendFromLineClient /></Suspense>;
}
