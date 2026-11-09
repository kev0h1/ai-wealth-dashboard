import { Suspense } from "react";
import CategoryIconsClient from "./CategoryIconsClient";

export default function Page() {
  return <Suspense fallback={null}><CategoryIconsClient /></Suspense>;
}
