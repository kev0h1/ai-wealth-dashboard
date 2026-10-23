import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import SpendFromLineClient from "./SpendFromLineClient";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function SpendFromLinePage() {
  // Resolve query-selected fixtures during the request, rather than making
  // the entire preview wait for client-side hydration before its first paint.
  await connection();
  return <Suspense fallback={<p className="p-6 text-sm">Loading the layout examples…</p>}><SpendFromLineClient /></Suspense>;
}
