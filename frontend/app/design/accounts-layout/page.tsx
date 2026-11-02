import { Suspense } from "react";
import AccountsLayoutClient from "./AccountsLayoutClient";

export default function AccountsLayoutPage() {
  return <Suspense fallback={<main className="min-h-dvh bg-slate-100 p-6 text-slate-700">Loading Accounts layout preview…</main>}><AccountsLayoutClient /></Suspense>;
}
