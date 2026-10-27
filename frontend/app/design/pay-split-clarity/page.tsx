import { Suspense } from "react";
import FlowPreview from "./FlowPreview";
export default function Page() { return <Suspense fallback={<p className="p-6">Loading preview…</p>}><FlowPreview /></Suspense>; }
