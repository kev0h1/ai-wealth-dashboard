import { Suspense } from "react";
import MirrorLoopClient from "./MirrorLoopClient";

export default function Page() {
  return <Suspense fallback={null}><MirrorLoopClient /></Suspense>;
}
