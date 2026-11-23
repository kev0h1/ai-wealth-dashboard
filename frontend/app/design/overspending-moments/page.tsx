import { Suspense } from "react";
import OverspendingMoments from "./OverspendingMoments";

export default function Page() {
  return <Suspense fallback={null}><OverspendingMoments /></Suspense>;
}
