import { Suspense } from "react";
import SpendFromAccountsClient from "./SpendFromAccountsClient";

export default function Page() {
  return <Suspense fallback={null}><SpendFromAccountsClient /></Suspense>;
}
