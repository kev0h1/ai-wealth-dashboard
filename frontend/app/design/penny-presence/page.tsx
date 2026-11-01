import { Suspense } from "react";
import PennyPresenceClient from "./PennyPresenceClient";

export default function PennyPresencePage() {
  return <Suspense fallback={<main className="p-5 text-sm text-slate-700 dark:text-slate-200">Loading Penny presence…</main>}><PennyPresenceClient /></Suspense>;
}
