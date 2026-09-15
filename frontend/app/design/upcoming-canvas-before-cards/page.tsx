import { Suspense } from "react";
import UpcomingCanvasClient from "./UpcomingCanvasClient";

export default function Page() {
  return <Suspense fallback={null}><UpcomingCanvasClient /></Suspense>;
}
