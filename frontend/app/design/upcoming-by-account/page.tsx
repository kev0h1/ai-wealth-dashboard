import { Suspense } from "react";
import PreviewClient from "./G416Preview";

export default function Page() {
  return <Suspense fallback={null}><PreviewClient /></Suspense>;
}
