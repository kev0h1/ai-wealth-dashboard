import { Suspense } from "react";
import MirrorReadingEdgeClient from "./MirrorReadingEdgeClient";

export default function Page() {
  return <Suspense fallback={null}><MirrorReadingEdgeClient /></Suspense>;
}
