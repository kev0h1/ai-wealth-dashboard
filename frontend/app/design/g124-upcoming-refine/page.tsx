import { Suspense } from "react";
import G124Client from "./G124Client";

export default function Page() {
  return <Suspense fallback={null}><G124Client /></Suspense>;
}
