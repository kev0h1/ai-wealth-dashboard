import { Suspense } from "react";
import Preview from "./Preview";

export default function AccountDetailCalmPage() {
  return <Suspense fallback={null}><Preview /></Suspense>;
}
