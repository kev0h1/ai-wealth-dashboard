import { Suspense } from "react";
import MarketingRoute from "./MarketingRoute";

export default function Page() {
  return <Suspense fallback={<p className="p-6">Loading the marketing kit…</p>}><MarketingRoute /></Suspense>;
}
