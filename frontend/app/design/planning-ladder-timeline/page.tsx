import { Suspense } from "react";
import PlanningLadderTimelineClient from "./PlanningLadderTimelineClient";

export default function Page() { return <Suspense fallback={null}><PlanningLadderTimelineClient /></Suspense>; }
