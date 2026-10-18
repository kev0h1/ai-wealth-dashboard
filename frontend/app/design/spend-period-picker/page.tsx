import { Suspense } from "react";
import SpendPeriodPickerClient from "./SpendPeriodPickerClient";

export default function Page() {
  return <Suspense fallback={null}><SpendPeriodPickerClient /></Suspense>;
}
