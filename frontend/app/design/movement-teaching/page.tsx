import { Suspense } from "react";
import MovementTeachingClient from "./MovementTeachingClient";

// G376 review route. Local fixtures only: this does not save a correction,
// create a goal or write a merchant rule.
export default function Page() {
  return <Suspense fallback={null}><MovementTeachingClient /></Suspense>;
}
