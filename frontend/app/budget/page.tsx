import { Suspense } from "react";
import BudgetPage from "./BudgetPage";

export default function Page() {
  return <Suspense><BudgetPage /></Suspense>;
}
