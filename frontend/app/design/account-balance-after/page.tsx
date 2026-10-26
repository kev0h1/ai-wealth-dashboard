import { Suspense } from "react";
import BalanceAfterClient from "./BalanceAfterClient";

export default function Page() {
  return <Suspense fallback={null}><BalanceAfterClient /></Suspense>;
}
