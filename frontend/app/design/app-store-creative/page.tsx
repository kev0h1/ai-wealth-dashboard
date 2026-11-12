import { Suspense } from "react";
import type { Metadata } from "next";
import CreativeReview from "./CreativeReview";

export const metadata: Metadata = {
  title: "App Store creative options | Sorted",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <Suspense fallback={<p className="p-6">Loading the creative options…</p>}><CreativeReview /></Suspense>;
}
