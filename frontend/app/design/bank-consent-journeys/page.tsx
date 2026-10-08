import { Suspense } from "react";
import ConsentJourneysClient from "./ConsentJourneysClient";

export default function Page() {
  return <Suspense fallback={<p className="p-6 text-sm">Loading design previews…</p>}><ConsentJourneysClient /></Suspense>;
}
