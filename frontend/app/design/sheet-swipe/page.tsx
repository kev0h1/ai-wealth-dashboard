import { Suspense } from "react";
import SheetSwipeClient from "./SheetSwipeClient";

export default function Page() {
  return <Suspense fallback={null}><SheetSwipeClient /></Suspense>;
}
