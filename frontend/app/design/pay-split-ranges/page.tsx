import { Suspense } from "react";
import RangePreview from "./RangePreview";
export default function Page() {
  return <Suspense fallback={<main className="p-6">Loading design…</main>}><RangePreview /></Suspense>;
}
