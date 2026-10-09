import { Suspense } from "react";
import PennyFullscreenClient from "./PennyFullscreenClient";

export default function PennyFullscreenPage() {
  return <Suspense fallback={null}><PennyFullscreenClient /></Suspense>;
}
