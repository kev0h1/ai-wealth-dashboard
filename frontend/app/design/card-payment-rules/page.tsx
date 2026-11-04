import { Suspense } from "react";
import Preview from "./Preview";

export default function Page() {
  return <Suspense fallback={null}><Preview /></Suspense>;
}
