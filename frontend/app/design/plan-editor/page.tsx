import { Suspense } from "react";
import PlanEditorPreview from "./PlanEditorPreview";

export default function Page() {
  return <Suspense fallback={null}><PlanEditorPreview /></Suspense>;
}
