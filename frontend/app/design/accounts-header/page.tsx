import { Suspense } from "react";
import AccountsHeaderClient from "./AccountsHeaderClient";

// G236 Accounts header round. Fixtures only, no live data.
export default function Page() {
  return <Suspense fallback={null}><AccountsHeaderClient /></Suspense>;
}
