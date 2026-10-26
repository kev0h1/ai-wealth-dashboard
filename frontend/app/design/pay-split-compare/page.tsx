import { Suspense } from "react";
import ComparePreview from "./ComparePreview";
export default function Page() { return <Suspense fallback={<main className="p-6">Loading design…</main>}><ComparePreview /></Suspense>; }
