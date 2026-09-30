import { Suspense } from "react";
import PreviewClient from "./PreviewClient";

export default function Page() {
  return <Suspense fallback={null}><PreviewClient /></Suspense>;
}
