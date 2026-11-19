import { Suspense } from "react";
import MoneyInClient from "./MoneyInClient";

export default function Page() {
  return <Suspense fallback={null}><MoneyInClient /></Suspense>;
}
