import { Suspense } from "react";
import MergeReviewClient from "./MergeReviewClient";

export default function Page() {
  return <Suspense fallback={<p className="p-6 text-sm">Loading design preview…</p>}><MergeReviewClient /></Suspense>;
}
