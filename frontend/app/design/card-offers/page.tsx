import { Suspense } from "react";
import type { Metadata } from "next";
import CardOffersClient from "./CardOffersClient";

export const metadata: Metadata = {
  title: "Card offers design round | Sorted",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <Suspense fallback={null}><CardOffersClient /></Suspense>;
}
