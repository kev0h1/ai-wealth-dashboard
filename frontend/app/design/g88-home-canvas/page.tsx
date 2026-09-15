import { Suspense } from "react";
import G88HomeCanvasClient from "./G88HomeCanvasClient";

export default function Page() {
  return <Suspense fallback={null}><G88HomeCanvasClient /></Suspense>;
}
