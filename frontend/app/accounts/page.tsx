import { Suspense } from "react";
import AccountsPage from "../components/AccountsPage";

export default function Accounts() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#f0f2f7]" />}>
      <AccountsPage />
    </Suspense>
  );
}
