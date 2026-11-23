import { Suspense } from "react";
import CardPlanProgressPreview from "./CardPlanProgressPreview";

// Fixture-only design round. Query controls live in the client layer so each
// proposed state is reviewable at one stable, deep-linkable URL.
export default function Page() {
  return <Suspense fallback={null}><CardPlanProgressPreview /></Suspense>;
}
