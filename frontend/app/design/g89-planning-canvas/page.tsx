import { Suspense } from "react";
import G89PlanningCanvasClient from "./G89PlanningCanvasClient";

export default function Page() {
  return <Suspense fallback={null}><G89PlanningCanvasClient /></Suspense>;
}
