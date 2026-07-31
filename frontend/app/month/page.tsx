import { Suspense } from "react";
import MonthPage from "./MonthPage";

export default function Page() {
  return (
    <Suspense>
      <MonthPage />
    </Suspense>
  );
}
