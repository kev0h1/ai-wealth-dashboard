import { Suspense } from "react";
import UpcomingFlowClient from "./UpcomingFlowClient";

export default function Page() {
  return <Suspense fallback={null}><UpcomingFlowClient /></Suspense>;
}
