import { Suspense } from "react";
import PaydayPlanGrammarClient from "./PaydayPlanGrammarClient";

export default function Page() {
  return <Suspense fallback={null}><PaydayPlanGrammarClient /></Suspense>;
}
