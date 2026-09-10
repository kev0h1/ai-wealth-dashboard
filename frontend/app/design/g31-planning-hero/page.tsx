import { Suspense } from "react";
import G31PlanningHeroClient from "./G31PlanningHeroClient";

export default function Page() {
  return (
    <Suspense>
      <G31PlanningHeroClient />
    </Suspense>
  );
}
