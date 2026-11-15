import { Suspense } from "react";
import type { Metadata } from "next";
import CardOffersPage from "@/components/card-offers/CardOffersPage";

export const metadata: Metadata = { title: "Card offers | Sorted", robots: { index: false, follow: false } };

export default function Page() {
  return <Suspense fallback={<div className="min-h-dvh bg-[#f0f2f7] dark:bg-slate-900" />}><CardOffersPage /></Suspense>;
}
