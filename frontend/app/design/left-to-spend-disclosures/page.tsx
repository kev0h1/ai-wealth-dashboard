import { Suspense } from "react";
import Preview from "./Preview";

export default function LeftToSpendDisclosuresPage() {
  return <Suspense fallback={null}><Preview /></Suspense>;
}
