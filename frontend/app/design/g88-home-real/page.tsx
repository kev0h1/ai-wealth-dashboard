import { Suspense } from "react";
import G88HomeRealClient from "./G88HomeRealClient";

export default function Page() {
  return <Suspense fallback={null}><G88HomeRealClient /></Suspense>;
}
