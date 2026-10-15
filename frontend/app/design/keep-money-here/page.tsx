import { Suspense } from "react";
import KeepMoneyHereClient from "./KeepMoneyHereClient";

export default function Page() {
  return <Suspense fallback={null}><KeepMoneyHereClient /></Suspense>;
}
