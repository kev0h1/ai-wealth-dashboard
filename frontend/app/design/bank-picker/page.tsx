import { Suspense } from "react";
import BankPickerClient from "./BankPickerClient";

export default function Page() {
  return <Suspense fallback={null}><BankPickerClient /></Suspense>;
}
