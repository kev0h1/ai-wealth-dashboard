import { Suspense } from "react";
import PlayExtras from "./PlayExtras";

export default function Page() {
  return <Suspense fallback={<p className="p-6">Loading Google Play extras…</p>}><PlayExtras /></Suspense>;
}
