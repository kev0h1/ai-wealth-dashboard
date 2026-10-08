import { Suspense } from "react";
import MarketingKit from "./MarketingKit";

export default function Page() {
  return <Suspense fallback={<p className="p-6">Loading the marketing kit…</p>}><MarketingKit /></Suspense>;
}
